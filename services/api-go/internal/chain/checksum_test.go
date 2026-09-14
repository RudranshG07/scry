package chain

import (
	"strings"
	"testing"
)

func TestChecksum(t *testing.T) {
	addrs := []string{
		"0x52908400098527886E0F7030069857D2E4169EE7",
		"0x8617E340B3D01FA5F11F306F4090FD50E238070D",
		"0xde709f2102306220921060314715629080e2fb77",
		"0x27b1fdb04752bbc536007a920d24acb045561c26",
		"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
		"0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
		"0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
		"0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
	}

	for _, addr := range addrs {
		if got := Checksum(addr); got != addr {
			t.Errorf("Checksum(%s) = %s", addr, got)
		}
	}
}

func TestChecksumBad(t *testing.T) {
	for _, in := range []string{"", "0x", "zz", strings.Repeat("a", 200)} {
		if got := Checksum(in); got != in {
			t.Errorf("Checksum(%q) = %q, want it unchanged", in, got)
		}
	}
}

func FuzzChecksum(f *testing.F) {
	f.Add(make([]byte, 20))
	f.Add([]byte{0x5a, 0xae, 0xb6, 0x05, 0x3f, 0x3e, 0x94, 0xc9, 0xb9, 0xa0,
		0x9f, 0x33, 0x66, 0x94, 0x35, 0xe7, 0xef, 0x1b, 0xea, 0xed})

	f.Fuzz(func(t *testing.T, raw []byte) {
		b := make([]byte, 20)
		copy(b, raw)
		addr := "0x" + hexOf(b)

		got := Checksum(addr)

		if len(got) != 42 {
			t.Fatalf("Checksum(%s) = %q", addr, got)
		}
		if Checksum(got) != got {
			t.Fatalf("not idempotent: %q -> %q", got, Checksum(got))
		}
		if Checksum(strings.ToUpper(addr)) != got {
			t.Fatalf("case sensitive: %q", addr)
		}
	})
}
