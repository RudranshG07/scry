package chain

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/sha3"
)

func hexOf(raw []byte) string { return hex.EncodeToString(raw) }

func unhex(text string) ([]byte, error) {
	return hex.DecodeString(strings.TrimPrefix(text, "0x"))
}

func keccak(parts ...[]byte) []byte {
	digest := sha3.NewLegacyKeccak256()
	for _, part := range parts {
		digest.Write(part)
	}
	return digest.Sum(nil)
}

// selector is the first four bytes of the keccak of a function's signature,
// which is how the EVM tells one method from another.
func selector(signature string) []byte {
	return keccak([]byte(signature))[:4]
}

// word left-pads to the 32 bytes every ABI argument occupies.
func word(raw []byte) []byte {
	if len(raw) > 32 {
		panic("argument wider than a word")
	}
	padded := make([]byte, 32)
	copy(padded[32-len(raw):], raw)
	return padded
}

func wordOfInt(value *big.Int) []byte { return word(value.Bytes()) }

// Bytes32 turns a 0x-prefixed hash into the fixed 32 bytes the ABI wants.
func Bytes32(text string) ([32]byte, error) {
	var out [32]byte
	raw, err := unhex(text)
	if err != nil {
		return out, err
	}
	if len(raw) != 32 {
		return out, fmt.Errorf("expected 32 bytes, got %d", len(raw))
	}
	copy(out[:], raw)
	return out, nil
}

// ResolveCall builds the calldata for PooledMarket.resolve.
func ResolveCall(outcomeID [32]byte, value *big.Int, root [32]byte) []byte {
	data := selector("resolve(bytes32,uint256,bytes32)")
	data = append(data, outcomeID[:]...)
	data = append(data, wordOfInt(value)...)
	data = append(data, root[:]...)
	return data
}

// InvalidateCall builds the calldata for PooledMarket.invalidate.
func InvalidateCall(reason [32]byte) []byte {
	return append(selector("invalidate(bytes32)"), reason[:]...)
}

// MarketForCall builds the calldata for MarketFactory.marketFor.
func MarketForCall(marketID [32]byte) []byte {
	return append(selector("marketFor(bytes32)"), marketID[:]...)
}

// AddressFromWord reads the address out of a 32 byte return value.
func AddressFromWord(raw []byte) (string, error) {
	if len(raw) < 32 {
		return "", fmt.Errorf("expected a word, got %d bytes", len(raw))
	}
	return "0x" + hexOf(raw[12:32]), nil
}

// MarketKey is how a market id in Postgres becomes one on chain. Ids there are
// readable strings like stream-sd-8-taylor-1786984630 and the contracts index
// by bytes32, so the hash is the join between the two.
func MarketKey(marketID string) [32]byte {
	var out [32]byte
	copy(out[:], keccak([]byte(marketID)))
	return out
}
