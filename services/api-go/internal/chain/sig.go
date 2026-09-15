package chain

import (
	"errors"
	"fmt"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

var ErrBadSignature = errors.New("bad signature")

// SignDigest signs a digest as it stands, with no personal_sign prefix, laid
// out the way the resolver reads it: r, s, then v as 27 or 28.
func (s *Signer) SignDigest(digest [32]byte) []byte {
	compact := ecdsa.SignCompact(s.key, digest[:], false)
	return append(compact[1:65:65], compact[0])
}

// SignerOf recovers who signed a digest. It refuses the high-s twin of a
// signature just as the resolver does, so nothing accepted here is refused on
// chain after the fact.
func SignerOf(digest [32]byte, signature []byte) (string, error) {
	if len(signature) != 65 {
		return "", ErrBadSignature
	}
	v := signature[64]
	if v >= 27 {
		v -= 27
	}
	if v > 1 {
		return "", ErrBadSignature
	}
	var s secp256k1.ModNScalar
	if overflow := s.SetByteSlice(signature[32:64]); overflow || s.IsOverHalfOrder() {
		return "", ErrBadSignature
	}

	compact := append([]byte{v + 27}, signature[:64]...)
	pub, _, err := ecdsa.RecoverCompact(compact, digest[:])
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrBadSignature, err)
	}
	raw := pub.SerializeUncompressed()
	return Checksum(hexOf(keccak(raw[1:])[12:])), nil
}
