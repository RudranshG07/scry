package httpapi

import "testing"

func TestSplitOriginsAcceptsBothLocalhostSpellings(t *testing.T) {
	got := splitOrigins("http://127.0.0.1:3000, http://localhost:3000/")
	if len(got) != 2 || got[0] != "http://127.0.0.1:3000" || got[1] != "http://localhost:3000" {
		t.Fatalf("got %v", got)
	}
}

func TestSplitOriginsFallsBackRatherThanAllowingNothing(t *testing.T) {
	if got := splitOrigins("   "); len(got) != 1 {
		t.Fatalf("got %v", got)
	}
}

func TestWebsocketPatternsKeepThePort(t *testing.T) {
	if got := hostPortOf("http://localhost:3000"); got != "localhost:3000" {
		t.Errorf("got %q, want localhost:3000", got)
	}
}

func TestSignInDomainDropsThePort(t *testing.T) {
	if got := hostOf("http://localhost:3000"); got != "localhost" {
		t.Errorf("got %q, want localhost", got)
	}
}
