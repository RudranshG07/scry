package engine

import (
	"testing"
	"time"
)

func ptr(v int64) *int64 { return &v }

func TestConsensus(t *testing.T) {
	cases := []struct {
		name   string
		counts []int64
		want   int64
		agreed bool
	}{
		{"no reports at all", nil, 0, false},
		{"one observer is never enough", []int64{182}, 0, false},
		{"two that agree exactly", []int64{182, 182}, 182, true},
		{"two within tolerance", []int64{182, 184}, 184, true},
		{"two too far apart", []int64{182, 210}, 0, false},
		{"outlier dropped, majority stands", []int64{181, 182, 300}, 182, true},
		{"all three spread out", []int64{100, 200, 300}, 0, false},
		{"tight cluster beats a lone reading", []int64{9, 180, 181, 182}, 181, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, agreed := consensus(c.counts, tolerance, minObservers)
			if agreed != c.agreed {
				t.Fatalf("agreed = %v, want %v", agreed, c.agreed)
			}
			if agreed && got != c.want {
				t.Errorf("value = %d, want %d", got, c.want)
			}
		})
	}
}

func TestConsensusDoesNotReorderCaller(t *testing.T) {
	counts := []int64{300, 181, 182}
	consensus(counts, tolerance, minObservers)
	if counts[0] != 300 {
		t.Errorf("caller slice was sorted in place: %v", counts)
	}
}

func TestWinner(t *testing.T) {
	// The usual binary market: above 180, or 180 and below.
	above := band{id: "yes", min: ptr(181)}
	below := band{id: "no", max: ptr(180)}
	bands := []band{above, below}

	cases := []struct {
		name  string
		value int64
		want  string
		ok    bool
	}{
		{"clearly above", 213, "yes", true},
		{"just above", 181, "yes", true},
		{"exactly on the threshold", 180, "no", true},
		{"well below", 12, "no", true},
		{"zero still resolves", 0, "no", true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := winner(c.value, bands)
			if ok != c.ok || got != c.want {
				t.Errorf("winner(%d) = %q, %v; want %q, %v", c.value, got, ok, c.want, c.ok)
			}
		})
	}
}

func TestWinnerRejectsAmbiguousBands(t *testing.T) {
	// Overlapping bands: 181 sits in both, so the market cannot settle.
	overlapping := []band{
		{id: "yes", min: ptr(180)},
		{id: "no", max: ptr(200)},
	}
	if _, ok := winner(181, overlapping); ok {
		t.Error("overlapping bands resolved, want a refusal")
	}

	// Gapped bands: nothing covers 190.
	gapped := []band{
		{id: "low", max: ptr(180)},
		{id: "high", min: ptr(200)},
	}
	if _, ok := winner(190, gapped); ok {
		t.Error("gapped bands resolved, want a refusal")
	}
}

func TestRuleHashIsStableAndDistinct(t *testing.T) {
	a := ruleHash("m-1", 180, timeAt(1000))
	if a != ruleHash("m-1", 180, timeAt(1000)) {
		t.Error("same inputs produced different hashes")
	}
	if a == ruleHash("m-1", 181, timeAt(1000)) {
		t.Error("threshold change did not change the hash")
	}
	if len(a) != 66 || a[:2] != "0x" {
		t.Errorf("hash %q does not match the schema constraint", a)
	}
}

func timeAt(unix int64) time.Time { return time.Unix(unix, 0).UTC() }
