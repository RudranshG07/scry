package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
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

func (c *Client) BlockNumber(ctx context.Context) (uint64, error) {
	raw, err := c.call(ctx, "eth_blockNumber")
	if err != nil {
		return 0, err
	}
	value, err := quantity(raw)
	if err != nil {
		return 0, err
	}
	return value.Uint64(), nil
}

type Log struct {
	Address          string
	Topics           []string
	Data             []byte
	BlockNumber      uint64
	BlockHash        string
	TransactionHash  string
	TransactionIndex uint64
	LogIndex         uint64
	Removed          bool
}

func (c *Client) Logs(ctx context.Context, from, to uint64, addresses, topics []string) ([]Log, error) {
	raw, err := c.call(ctx, "eth_getLogs", map[string]any{
		"fromBlock": fmt.Sprintf("0x%x", from),
		"toBlock":   fmt.Sprintf("0x%x", to),
		"address":   addresses,
		"topics":    [][]string{topics},
	})
	if err != nil {
		return nil, err
	}
	var wire []struct {
		Address          string   `json:"address"`
		Topics           []string `json:"topics"`
		Data             string   `json:"data"`
		BlockNumber      string   `json:"blockNumber"`
		BlockHash        string   `json:"blockHash"`
		TransactionHash  string   `json:"transactionHash"`
		TransactionIndex string   `json:"transactionIndex"`
		LogIndex         string   `json:"logIndex"`
		Removed          bool     `json:"removed"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return nil, fmt.Errorf("eth_getLogs: %w", err)
	}

	logs := make([]Log, 0, len(wire))
	for _, entry := range wire {
		data, err := unhex(entry.Data)
		if err != nil {
			return nil, fmt.Errorf("log data: %w", err)
		}
		block, blockErr := hexUint(entry.BlockNumber)
		index, indexErr := hexUint(entry.LogIndex)
		position, positionErr := hexUint(entry.TransactionIndex)
		if err := errors.Join(blockErr, indexErr, positionErr); err != nil {
			return nil, fmt.Errorf("log position: %w", err)
		}
		logs = append(logs, Log{
			Address:          entry.Address,
			Topics:           entry.Topics,
			Data:             data,
			BlockNumber:      block,
			BlockHash:        entry.BlockHash,
			TransactionHash:  entry.TransactionHash,
			TransactionIndex: position,
			LogIndex:         index,
			Removed:          entry.Removed,
		})
	}
	return logs, nil
}

func hexUint(text string) (uint64, error) {
	return strconv.ParseUint(strings.TrimPrefix(text, "0x"), 16, 64)
}

func (c *Client) EstimateGas(ctx context.Context, from, to string, data []byte) (uint64, error) {
	raw, err := c.call(ctx, "eth_estimateGas", map[string]string{
		"from": from, "to": to, "data": "0x" + hexOf(data),
	})
	if err != nil {
		return 0, err
	}
	value, err := quantity(raw)
	if err != nil {
		return 0, err
	}
	return value.Uint64(), nil
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

type Receipt struct {
	Status      uint64
	BlockNumber uint64
}

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
