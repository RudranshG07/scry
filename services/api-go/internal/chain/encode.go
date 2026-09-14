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

func Checksum(addr string) string {
	lower := strings.TrimPrefix(strings.ToLower(addr), "0x")
	if len(lower) != 40 {
		return addr
	}
	sum := keccak([]byte(lower))

	out := []byte(lower)
	for i, c := range out {
		if c < 'a' || c > 'f' {
			continue
		}
		nibble := sum[i/2] >> 4
		if i%2 == 1 {
			nibble = sum[i/2] & 0x0f
		}
		if nibble >= 8 {
			out[i] = c - 32
		}
	}
	return "0x" + string(out)
}

func keccak(parts ...[]byte) []byte {
	digest := sha3.NewLegacyKeccak256()
	for _, part := range parts {
		digest.Write(part)
	}
	return digest.Sum(nil)
}

func selector(signature string) []byte {
	return keccak([]byte(signature))[:4]
}

func word(raw []byte) []byte {
	if len(raw) > 32 {
		panic("argument wider than a word")
	}
	padded := make([]byte, 32)
	copy(padded[32-len(raw):], raw)
	return padded
}

func wordOfInt(value *big.Int) []byte { return word(value.Bytes()) }

func Bytes32(text string) ([32]byte, error) {
	var out [32]byte
	raw, err := unhex(text)
	if err != nil {
		return out, err
	}
	if len(raw) != 32 {
		return out, fmt.Errorf("want 32 bytes, got %d", len(raw))
	}
	copy(out[:], raw)
	return out, nil
}

func ResolveCall(outcomeID [32]byte, value *big.Int, root [32]byte) []byte {
	data := selector("resolve(bytes32,uint256,bytes32)")
	data = append(data, outcomeID[:]...)
	data = append(data, wordOfInt(value)...)
	data = append(data, root[:]...)
	return data
}

func InvalidateCall(reason [32]byte) []byte {
	return append(selector("invalidate(bytes32)"), reason[:]...)
}

func MarketForCall(marketID [32]byte) []byte {
	return append(selector("marketFor(bytes32)"), marketID[:]...)
}

func AddressFromWord(raw []byte) (string, error) {
	if len(raw) < 32 {
		return "", fmt.Errorf("want 32 bytes, got %d", len(raw))
	}
	return Checksum(hexOf(raw[12:32])), nil
}

func MarketKey(marketID string) [32]byte {
	var out [32]byte
	copy(out[:], keccak([]byte(marketID)))
	return out
}
