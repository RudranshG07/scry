package engine

import (
	"strings"
	"testing"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
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
			got, agreed := consensus(c.counts, minObservers)
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
	consensus(counts, minObservers)
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

func TestAllowedSpreadScalesWithVolume(t *testing.T) {
	cases := []struct {
		base, want int64
	}{
		{0, 2},  // the floor holds where a percentage is meaningless
		{10, 2}, // 5% of 10 is below the floor
		{40, 2}, // 5% of 40 is exactly the floor
		{100, 5},
		{135, 7},
		{300, 15},
	}
	for _, c := range cases {
		if got := allowedSpread(c.base); got != c.want {
			t.Errorf("allowedSpread(%d) = %d, want %d", c.base, got, c.want)
		}
	}
}

// The two live detector profiles produced 127 and 135 on the same window, a
// 6.3% spread. The qualification gate accepts 3-5% counting error, so this is a
// detector that has not earned a result rather than a tolerance set too tight.
func TestConsensusRejectsDetectorSpreadAboveTheQualificationBar(t *testing.T) {
	if _, ok := consensus([]int64{127, 135}, minObservers); ok {
		t.Error("127 and 135 agreed; that is 6.3%, above the 5% bar")
	}
	// Tighten the detector and the same window settles.
	if value, ok := consensus([]int64{131, 135}, minObservers); !ok || value != 135 {
		t.Errorf("131 and 135 = %d, %v; want agreement inside 5%%", value, ok)
	}
}

func TestConsensusStillRejectsWildDisagreement(t *testing.T) {
	// Proportional tolerance must not become a licence to agree on anything.
	if _, ok := consensus([]int64{100, 200}, minObservers); ok {
		t.Error("100 and 200 agreed; 5% of 100 is 5, not 100")
	}
}

// Paired observer counts measured off the three live cameras. Two of them
// settle inside the bar window after window; the third does not, and the
// difference is the camera rather than the detector, which is the case this
// gate exists to catch.
func TestVerdictSuspendsOnlyTheStreamObserversCannotAgreeOn(t *testing.T) {
	cases := []struct {
		stream  string
		windows []window
		want    string
	}{
		{"sd-8-15", []window{{238, 246}, {155, 157}, {193, 195}, {318, 318}}, "Qualified"},
		{"sd-5-28th", []window{{127, 146}, {106, 115}, {21, 21}, {318, 318}}, "Suspended"},
	}
	for _, c := range cases {
		got, agreed, ok := verdict(c.windows)
		if !ok {
			t.Fatalf("%s: not judged on %d windows", c.stream, len(c.windows))
		}
		if got != c.want {
			t.Errorf("%s: %s after %d/%d agreed, want %s",
				c.stream, got, agreed, len(c.windows), c.want)
		}
	}
}

func TestVerdictWithholdsJudgementUntilThereIsHistory(t *testing.T) {
	// One bad window is a truck, not a broken camera. Suspending on it would
	// take a working stream offline for noise.
	if _, _, ok := verdict([]window{{100, 180}}); ok {
		t.Error("judged a stream on a single window")
	}
}

func TestVerdictToleratesTheOccasionalBadWindow(t *testing.T) {
	ws := []window{{200, 204}, {150, 152}, {100, 180}, {180, 182}}
	got, _, _ := verdict(ws)
	if got != "Qualified" {
		t.Errorf("got %s; 3 of 4 windows agreed, which is above the bar", got)
	}
}

func TestObservableRequiresTheLineTheCounterNeeds(t *testing.T) {
	line := []any{[]any{0.05, 0.42}, []any{0.95, 0.42}}

	cases := []struct {
		name  string
		claim domain.Claim
		want  bool
	}{
		{"crossings with a drawn line", domain.Claim{Kind: "crossings", Target: "person",
			Options: map[string]any{"line": line}}, true},
		// This is the shape every scheduled market had, and why none of them
		// could ever be counted.
		{"crossings with no options at all", domain.Claim{Kind: "crossings", Target: "anything"}, false},
		{"crossings with half a line", domain.Claim{Kind: "crossings", Target: "anything",
			Options: map[string]any{"line": []any{[]any{0.1, 0.5}}}}, false},
		{"a phrase to listen for", domain.Claim{Kind: "phrase", Target: "hello guys"}, true},
		{"a phrase with nothing to match", domain.Claim{Kind: "phrase"}, false},
		{"a kind no observer registers", domain.Claim{Kind: "smell", Target: "petrichor"}, false},
	}

	for _, c := range cases {
		if got := observable(c.claim); got != c.want {
			t.Errorf("%s: observable = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestQuestionMatchesWhatIsBeingCounted(t *testing.T) {
	spoken := questionFor(domain.Claim{Kind: "phrase", Target: "hello guys"}, 12, "events")
	if !strings.Contains(spoken, "hello guys") || !strings.Contains(spoken, "said") {
		t.Errorf("a phrase market should ask about the phrase, got %q", spoken)
	}
	if strings.Contains(spoken, "count line") {
		t.Errorf("a phrase market has no count line to cross, got %q", spoken)
	}

	crossed := questionFor(domain.Claim{Kind: "crossings", Target: "anything"}, 180, "vehicles")
	if !strings.Contains(crossed, "180 vehicles cross the count line") {
		t.Errorf("unexpected crossings question %q", crossed)
	}
}
