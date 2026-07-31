package auth

import (
	"strings"
	"testing"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// Private key 0x…01 belongs to this address. Hard-coding the pair means the test
// covers the whole pipeline — keccak, the personal_sign prefix, recovery and
// address derivation — rather than just checking our own code round-trips.
const (
	knownAddress = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
	domain       = "scry.markets"
	nonce        = "9f2c1a7be4d8"
)

func key(t *testing.T) *secp256k1.PrivateKey {
	t.Helper()
	var b [32]byte
	b[31] = 1
	return secp256k1.PrivKeyFromBytes(b[:])
}

// sign produces what a wallet returns from personal_sign: r || s || v, v as 27/28.
func sign(t *testing.T, message string) string {
	t.Helper()
	compact := ecdsa.SignCompact(key(t), hash(message), false)
	return "0x" + toHex(append(compact[1:], compact[0]))
}

func message() string {
	return Build(domain, knownAddress, nonce, "2026-07-31T06:00:00Z", "Sign in to Scry.")
}

func TestRecoverFindsTheSigningAddress(t *testing.T) {
	m := message()
	got, err := Recover(m, sign(t, m))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.EqualFold(got, knownAddress) {
		t.Errorf("recovered %s, want %s", got, knownAddress)
	}
}

func TestVerifyAcceptsAGenuineSignIn(t *testing.T) {
	m := message()
	if err := Verify(m, sign(t, m), domain, knownAddress, nonce); err != nil {
		t.Fatal(err)
	}
}

func TestSignatureForAnotherSiteIsRefused(t *testing.T) {
	// A real signature, freely given somewhere else. Without the domain check it
	// would sign the holder in here too.
	elsewhere := Build("evil.example", knownAddress, nonce, "2026-07-31T06:00:00Z", "Sign in.")
	if err := Verify(elsewhere, sign(t, elsewhere), domain, knownAddress, nonce); err != ErrWrongDomain {
		t.Errorf("got %v, want ErrWrongDomain", err)
	}
}

func TestSignatureCarryingAnotherNonceIsRefused(t *testing.T) {
	// The signature is valid and for this site, but from an earlier sign-in.
	old := Build(domain, knownAddress, "0000deadbeef", "2026-07-31T05:00:00Z", "Sign in to Scry.")
	if err := Verify(old, sign(t, old), domain, knownAddress, nonce); err != ErrNonceMismatch {
		t.Errorf("got %v, want ErrNonceMismatch", err)
	}
}

func TestSigningForOneAddressDoesNotSignInAnother(t *testing.T) {
	m := message()
	other := "0x000000000000000000000000000000000000dead"
	if err := Verify(m, sign(t, m), domain, other, nonce); err != ErrWrongAddress {
		t.Errorf("got %v, want ErrWrongAddress", err)
	}
}

func TestATamperedMessageDoesNotVerify(t *testing.T) {
	m := message()
	signature := sign(t, m)
	// Same signature, message altered after the fact.
	tampered := strings.Replace(m, "Sign in to Scry.", "Send everything to me.", 1)
	if err := Verify(tampered, signature, domain, knownAddress, nonce); err == nil {
		t.Error("a signature over different text was accepted")
	}
}

func TestGarbageSignaturesAreRejected(t *testing.T) {
	m := message()
	for _, bad := range []string{"", "0x", "0xzz", "0x1234", strings.Repeat("0", 130)} {
		if err := Verify(m, bad, domain, knownAddress, nonce); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestParseRejectsSomethingThatIsNotASignInMessage(t *testing.T) {
	for _, bad := range []string{"", "hello", "just one line"} {
		if _, err := Parse(bad); err != ErrMalformedMessage {
			t.Errorf("%q: got %v, want ErrMalformedMessage", bad, err)
		}
	}
}

func TestTheSignedTextIsNotMistakenForATransaction(t *testing.T) {
	// personal_sign prefixes the payload precisely so a signature gathered for
	// a login cannot also be a valid signature over raw transaction bytes.
	m := message()
	if string(hash(m)) == string(keccak([]byte(m))) {
		t.Error("message was hashed without the personal_sign prefix")
	}
}
