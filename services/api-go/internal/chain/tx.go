package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// A legacy transaction is enough. Base and Polygon both accept them, and the
// alternative is carrying a fee-market implementation for no benefit: these
// calls are rare, small, and not competing for blockspace.
const gasLimit uint64 = 300_000

type Signer struct {
	key     *secp256k1.PrivateKey
	Address string
}

// NewSigner takes a hex private key, with or without the 0x.
func NewSigner(hexKey string) (*Signer, error) {
	raw, err := unhex(hexKey)
	if err != nil {
		return nil, fmt.Errorf("private key is not hex: %w", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("private key must be 32 bytes, got %d", len(raw))
	}
	key := secp256k1.PrivKeyFromBytes(raw)

	// An address is the last twenty bytes of the keccak of the uncompressed
	// public key without its 0x04 prefix.
	pub := key.PubKey().SerializeUncompressed()
	return &Signer{key: key, Address: "0x" + hexOf(keccak(pub[1:])[12:])}, nil
}

// rlp encodes one byte string.
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

// rlpInt encodes a number the way RLP wants it: big-endian, no leading zeros,
// and zero itself as the empty string rather than a zero byte.
func rlpInt(value *big.Int) []byte {
	if value == nil || value.Sign() == 0 {
		return rlpBytes(nil)
	}
	return rlpBytes(value.Bytes())
}

type Call struct {
	To    string
	Data  []byte
	Nonce uint64
	Gas   *big.Int
	Chain *big.Int
}

// Sign produces a signed legacy transaction, replay-protected per EIP-155.
func (s *Signer) Sign(call Call) ([]byte, error) {
	to, err := unhex(call.To)
	if err != nil {
		return nil, fmt.Errorf("destination is not hex: %w", err)
	}

	fields := [][]byte{
		rlpInt(new(big.Int).SetUint64(call.Nonce)),
		rlpInt(call.Gas),
		rlpInt(new(big.Int).SetUint64(gasLimit)),
		rlpBytes(to),
		rlpInt(nil), // no ether moves; the collateral is ERC20
		rlpBytes(call.Data),
	}

	// The chain id goes into the digest so a transaction signed for one chain
	// cannot be replayed on another.
	unsigned := rlpList(append(fields, rlpInt(call.Chain), rlpInt(nil), rlpInt(nil))...)
	digest := keccak(unsigned)

	compact := ecdsa.SignCompact(s.key, digest, false)
	if len(compact) != 65 {
		return nil, fmt.Errorf("signature is %d bytes, expected 65", len(compact))
	}
	// SignCompact leads with the recovery id offset by 27; EIP-155 wants it
	// folded into v alongside the chain id.
	recovery := big.NewInt(int64(compact[0] - 27))
	v := new(big.Int).Add(recovery, big.NewInt(35))
	v.Add(v, new(big.Int).Mul(call.Chain, big.NewInt(2)))

	return rlpList(append(fields,
		rlpInt(v),
		rlpBytes(compact[1:33]),
		rlpBytes(compact[33:65]),
	)...), nil
}

// Submit signs and sends, filling in nonce, gas price and chain id.
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

	signed, err := s.Sign(Call{To: to, Data: data, Nonce: nonce, Gas: gas, Chain: chainID})
	if err != nil {
		return "", err
	}
	return client.Send(ctx, signed)
}
