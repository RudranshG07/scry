package httpapi

import (
	"testing"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

func TestCountableRefusesWhatNoObserverCanRun(t *testing.T) {
	line := []any{[]any{0.05, 0.42}, []any{0.95, 0.42}}

	cases := []struct {
		name  string
		claim domain.Claim
		want  bool
	}{
		{"a drawn line", domain.Claim{Kind: "crossings", Options: map[string]any{"line": line}}, true},
		{"crossings without a line", domain.Claim{Kind: "crossings", Target: "car"}, false},
		{"a phrase to listen for", domain.Claim{Kind: "phrase", Target: "hello guys"}, true},
		{"a phrase of only spaces", domain.Claim{Kind: "phrase", Target: "   "}, false},
		{"a thing to look for", domain.Claim{Kind: "objects", Target: "person"}, true},
		{"a kind nothing implements", domain.Claim{Kind: "vibes", Target: "good"}, false},
		{"no claim at all", domain.Claim{}, false},
	}

	for _, c := range cases {
		reason, ok := countable(c.claim)
		if ok != c.want {
			t.Errorf("%s: countable = %v, want %v", c.name, ok, c.want)
		}
		if !ok && reason == "" {
			t.Errorf("%s: refused with no reason to show the submitter", c.name)
		}
	}
}

func TestStreamIDIsStablePerLinkAndDistinctBetweenThem(t *testing.T) {
	first := store.StreamID("Abbey Road Crossing", "https://youtube.com/watch?v=abc")
	again := store.StreamID("Abbey Road Crossing", "https://youtube.com/watch?v=abc")
	if first != again {
		t.Errorf("the same link produced %q then %q, so resubmitting would fork the stream", first, again)
	}

	other := store.StreamID("Abbey Road Crossing", "https://youtube.com/watch?v=xyz")
	if first == other {
		t.Errorf("two different cameras collided on %q", first)
	}
}

func TestStreamIDSurvivesNamesThatAreNotSlugs(t *testing.T) {
	for _, name := range []string{"", "   ", "🔴 LIVE 24/7", "////", "Καλημέρα"} {
		id := store.StreamID(name, "https://example.com/live.m3u8")
		if id == "" || id == "stream--" {
			t.Errorf("name %q produced an unusable id %q", name, id)
		}
	}
}
