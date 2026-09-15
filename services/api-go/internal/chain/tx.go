package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type Signer struct {
	key     *secp256k1.PrivateKey
	Address string
}

func NewSigner(hexKey string) (*Signer, error) {
	raw, err := unhex(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode key: %w", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("key must be 32 bytes, got %d", len(raw))
	}
	key := secp256k1.PrivKeyFromBytes(raw)

	pub := key.PubKey().SerializeUncompressed()
	return &Signer{key: key, Address: Checksum(hexOf(keccak(pub[1:])[12:]))}, nil
}

func rlpBytes(raw []byte) []byte {
	if len(raw) == 1 && raw[0] < 0x80 {
		return raw
	}
	return append(rlpLength(len(raw), 0x80), raw...)
}

func rlpList(items ...[]byte) []byte {
	var payload []byte
	for _, item := range items {
		payload = append(payload, item...)
	}
	return append(rlpLength(len(payload), 0xc0), payload...)
}

func rlpLength(length int, offset byte) []byte {
	if length < 56 {
		return []byte{offset + byte(length)}
	}
	size := big.NewInt(int64(length)).Bytes()
	return append([]byte{offset + 55 + byte(len(size))}, size...)
}

func rlpInt(value *big.Int) []byte {
	if value == nil || value.Sign() == 0 {
		return rlpBytes(nil)
	}
	return rlpBytes(value.Bytes())
}

type Call struct {
	To       string
	Data     []byte
	Nonce    uint64
	Gas      *big.Int
	GasLimit uint64
	ChainID  *big.Int
}

func (s *Signer) Sign(call Call) ([]byte, error) {
	to, err := unhex(call.To)
	if err != nil {
		return nil, fmt.Errorf("decode to: %w", err)
	}

	fields := [][]byte{
		rlpInt(new(big.Int).SetUint64(call.Nonce)),
		rlpInt(call.Gas),
		rlpInt(new(big.Int).SetUint64(call.GasLimit)),
		rlpBytes(to),
		rlpInt(nil),
		rlpBytes(call.Data),
	}

	unsigned := rlpList(append(fields, rlpInt(call.ChainID), rlpInt(nil), rlpInt(nil))...)
	digest := keccak(unsigned)

	compact := ecdsa.SignCompact(s.key, digest, false)
	if len(compact) != 65 {
		return nil, fmt.Errorf("bad signature length %d", len(compact))
	}
	recovery := big.NewInt(int64(compact[0] - 27))
	v := new(big.Int).Add(recovery, big.NewInt(35))
	v.Add(v, new(big.Int).Mul(call.ChainID, big.NewInt(2)))

	return rlpList(append(fields,
		rlpInt(v),
		rlpBytes(compact[1:33]),
		rlpBytes(compact[33:65]),
	)...), nil
}

// Submit estimates gas rather than assuming it. A fixed 300k covered the
// registry calls this was first tested with and not createMarket, which deploys
// a whole market contract.
func (s *Signer) Submit(ctx context.Context, client *Client, to string, data []byte) (string, error) {
	chainID, err := client.ChainID(ctx)
	if err != nil {
		return "", err
	}
	nonce, err := client.NonceAt(ctx, s.Address)
	if err != nil {
		return "", err
	}
	gas, err := client.GasPrice(ctx)
	if err != nil {
		return "", err
	}
	// A quarter over the node's suggestion, so a transaction is not left pending
	// behind a fee that moved while it was being signed.
	gas = new(big.Int).Div(new(big.Int).Mul(gas, big.NewInt(5)), big.NewInt(4))
	estimate, err := client.EstimateGas(ctx, s.Address, to, data)
	if err != nil {
		return "", err
	}

	signed, err := s.Sign(Call{
		To: to, Data: data, Nonce: nonce, Gas: gas, GasLimit: estimate + estimate/5, ChainID: chainID,
	})
	if err != nil {
		return "", err
	}
	return client.Send(ctx, signed)
}
