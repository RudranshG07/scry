// Package chain talks to an EVM node over JSON-RPC.
//
// Hand-rolled rather than pulling in go-ethereum: the only things needed here
// are four RPC calls, a legacy transaction, and three ABI encodings, and the
// signing primitives are already in this module for sign-in with Ethereum.
package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"
)

const callTimeout = 20 * time.Second

type Client struct {
	url  string
	http *http.Client
}

func New(url string) *Client {
	return &Client{url: url, http: &http.Client{Timeout: callTimeout}}
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e rpcError) Error() string { return fmt.Sprintf("rpc %d: %s", e.Code, e.Message) }

func (c *Client) call(ctx context.Context, method string, params ...any) (json.RawMessage, error) {
	if params == nil {
		params = []any{}
	}
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": method, "params": params,
	})
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", method, err)
	}
	defer response.Body.Close()

	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *rpcError       `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("%s: %w", method, err)
	}
	if envelope.Error != nil {
		return nil, fmt.Errorf("%s: %w", method, *envelope.Error)
	}
	return envelope.Result, nil
}

// quantity reads the hex-quantity encoding every JSON-RPC number uses.
func quantity(raw json.RawMessage) (*big.Int, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, err
	}
	value, ok := new(big.Int).SetString(strings.TrimPrefix(text, "0x"), 16)
	if !ok {
		return nil, fmt.Errorf("not a quantity: %q", text)
	}
	return value, nil
}

func (c *Client) ChainID(ctx context.Context) (*big.Int, error) {
	raw, err := c.call(ctx, "eth_chainId")
	if err != nil {
		return nil, err
	}
	return quantity(raw)
}

// NonceAt asks for the pending count, not the latest: two resolutions submitted
// in the same block otherwise reuse a nonce and the second is dropped.
func (c *Client) NonceAt(ctx context.Context, address string) (uint64, error) {
	raw, err := c.call(ctx, "eth_getTransactionCount", address, "pending")
	if err != nil {
		return 0, err
	}
	value, err := quantity(raw)
	if err != nil {
		return 0, err
	}
	return value.Uint64(), nil
}

func (c *Client) GasPrice(ctx context.Context) (*big.Int, error) {
	raw, err := c.call(ctx, "eth_gasPrice")
	if err != nil {
		return nil, err
	}
	return quantity(raw)
}

func (c *Client) Send(ctx context.Context, signed []byte) (string, error) {
	raw, err := c.call(ctx, "eth_sendRawTransaction", "0x"+hexOf(signed))
	if err != nil {
		return "", err
	}
	var hash string
	if err := json.Unmarshal(raw, &hash); err != nil {
		return "", err
	}
	return hash, nil
}

// Call runs a read against the node without spending anything.
func (c *Client) Call(ctx context.Context, to string, data []byte) ([]byte, error) {
	raw, err := c.call(ctx, "eth_call", map[string]string{
		"to": to, "data": "0x" + hexOf(data),
	}, "latest")
	if err != nil {
		return nil, err
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, err
	}
	return unhex(text)
}

// Receipt is the part of a transaction receipt worth acting on.
type Receipt struct {
	Status      uint64
	BlockNumber uint64
}

// WaitFor blocks until the transaction has been mined, or the context is done.
//
// Sending returns as soon as the node has the transaction, not when it has run
// it: a read taken straight after a send came back with the state unchanged,
// then showed the write a moment later. Anything that sends and then checks its
// own work has to wait here first.
func (c *Client) WaitFor(ctx context.Context, hash string) (Receipt, error) {
	for {
		raw, err := c.call(ctx, "eth_getTransactionReceipt", hash)
		if err != nil {
			return Receipt{}, err
		}
		var body struct {
			Status      string `json:"status"`
			BlockNumber string `json:"blockNumber"`
		}
		if err := json.Unmarshal(raw, &body); err == nil && body.BlockNumber != "" {
			status, err := quantity(json.RawMessage(`"` + body.Status + `"`))
			if err != nil {
				return Receipt{}, err
			}
			block, err := quantity(json.RawMessage(`"` + body.BlockNumber + `"`))
			if err != nil {
				return Receipt{}, err
			}
			return Receipt{Status: status.Uint64(), BlockNumber: block.Uint64()}, nil
		}

		select {
		case <-ctx.Done():
			return Receipt{}, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
