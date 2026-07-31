// Package auth verifies that whoever is calling controls the address they claim.
//
// There are no passwords here on purpose. Positions settle to an address on
// chain, so the address is the account; anything else would be a second identity
// to keep in step with the first.
package auth

import (
	"errors"
	"fmt"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

var (
	ErrMalformedMessage = errors.New("malformed sign-in message")
	ErrBadSignature     = errors.New("signature does not match the address")
	ErrWrongDomain      = errors.New("message was signed for another site")
	ErrWrongAddress     = errors.New("message names a different address")
	ErrNonceMismatch    = errors.New("message carries a different nonce")
)

// Message is the part of a Sign-In With Ethereum payload worth checking. The
// full spec carries more, but every field here has to be verified or it is
// decoration: the domain stops a signature gathered elsewhere being replayed
// against this site, and the nonce stops one being replayed against this site
// twice.
type Message struct {
	Domain  string
	Address string
	Nonce   string
	Raw     string
}

// Build renders the message a wallet is asked to sign. The server composes it
// rather than accepting arbitrary text, so a caller cannot be tricked into
// signing something that means more than it appears to.
func Build(domain, address, nonce, issuedAt, statement string) string {
	return fmt.Sprintf(
		"%s wants you to sign in with your Ethereum account:\n%s\n\n%s\n\nURI: https://%s\nVersion: 1\nNonce: %s\nIssued At: %s",
		domain, address, statement, domain, nonce, issuedAt)
}

func Parse(raw string) (Message, error) {
	lines := strings.Split(raw, "\n")
	if len(lines) < 2 {
		return Message{}, ErrMalformedMessage
	}

	head, _, ok := strings.Cut(lines[0], " wants you to sign in")
	if !ok || head == "" {
		return Message{}, ErrMalformedMessage
	}

	m := Message{Domain: head, Address: strings.TrimSpace(lines[1]), Raw: raw}
	for _, line := range lines {
		if nonce, found := strings.CutPrefix(line, "Nonce: "); found {
			m.Nonce = strings.TrimSpace(nonce)
		}
	}
	if m.Address == "" || m.Nonce == "" {
		return Message{}, ErrMalformedMessage
	}
	return m, nil
}

// Verify checks the signature and that the message says what the server expects
// it to say. Recovering a valid address proves only that somebody signed
// something; the domain, address and nonce are what tie that signature to this
// sign-in and no other.
func Verify(raw, signature, domain, address, nonce string) error {
	m, err := Parse(raw)
	if err != nil {
		return err
	}
	if !strings.EqualFold(m.Domain, domain) {
		return ErrWrongDomain
	}
	if !strings.EqualFold(m.Address, address) {
		return ErrWrongAddress
	}
	if m.Nonce != nonce {
		return ErrNonceMismatch
	}

	signer, err := Recover(raw, signature)
	if err != nil {
		return err
	}
	if !strings.EqualFold(signer, address) {
		return ErrBadSignature
	}
	return nil
}

// Recover returns the address that produced a personal_sign signature.
func Recover(raw, signature string) (string, error) {
	sig, err := decodeHex(signature)
	if err != nil || len(sig) != 65 {
		return "", ErrBadSignature
	}

	// Wallets emit v as 27/28; the recovery code wants 0/1 in the leading byte.
	v := sig[64]
	if v >= 27 {
		v -= 27
	}
	if v > 1 {
		return "", ErrBadSignature
	}
	compact := append([]byte{v + 27}, sig[:64]...)

	pub, _, err := ecdsa.RecoverCompact(compact, hash(raw))
	if err != nil {
		return "", ErrBadSignature
	}

	// An Ethereum address is the last 20 bytes of the keccak of the uncompressed
	// public key with its 0x04 prefix dropped.
	raw65 := pub.SerializeUncompressed()
	sum := keccak(raw65[1:])
	return "0x" + toHex(sum[12:]), nil
}

// hash applies the personal_sign prefix. Without it a signature gathered here
// would be a valid signature over raw bytes, which is indistinguishable from a
// signed transaction to anything that does not know the difference.
func hash(message string) []byte {
	prefixed := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	return keccak([]byte(prefixed))
}

func keccak(data []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	return h.Sum(nil)
}

func decodeHex(s string) ([]byte, error) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "0x")
	if len(s)%2 != 0 {
		return nil, ErrBadSignature
	}
	out := make([]byte, len(s)/2)
	for i := range out {
		hi, err := nibble(s[i*2])
		if err != nil {
			return nil, err
		}
		lo, err := nibble(s[i*2+1])
		if err != nil {
			return nil, err
		}
		out[i] = hi<<4 | lo
	}
	return out, nil
}

func nibble(c byte) (byte, error) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', nil
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, nil
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, nil
	}
	return 0, ErrBadSignature
}

func toHex(data []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(data)*2)
	for i, b := range data {
		out[i*2] = digits[b>>4]
		out[i*2+1] = digits[b&0x0f]
	}
	return string(out)
}
