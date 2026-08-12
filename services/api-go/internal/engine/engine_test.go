package engine

import (
	"os"
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
		{"two within what independent detectors differ by", []int64{182, 210}, 210, true},
		{"two too far apart", []int64{182, 260}, 0, false},
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
		{5, 2},  // 20% of 5 is below the floor
		{10, 2}, // 20% of 10 is exactly the floor
		{100, 20},
		{135, 27},
		{300, 60},
	}
	for _, c := range cases {
		if got := allowedSpread(c.base); got != c.want {
			t.Errorf("allowedSpread(%d) = %d, want %d", c.base, got, c.want)
		}
	}
}

// Two different detectors on identical footage were measured at 35 and 30, a
// 16.7% spread, so the bar has to clear what independent models actually
// achieve. It still has to reject a detector that has come loose.
func TestConsensusAcceptsWhatIndependentDetectorsAchieve(t *testing.T) {
	if value, ok := consensus([]int64{35, 30}, minObservers); !ok || value != 35 {
		t.Errorf("35 and 30 = %d, %v; two models on the same window measured this", value, ok)
	}
	if _, ok := consensus([]int64{127, 135}, minObservers); !ok {
		t.Error("127 and 135 is 6.3% and should stand")
	}
	// Half again as many is not a counting difference, it is a broken observer.
	if _, ok := consensus([]int64{38, 59}, minObservers); ok {
		t.Error("38 and 59 is 55% and must not settle a market")
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
		{"sd-5-28th", []window{{127, 220}, {106, 180}, {21, 40}, {318, 318}}, "Suspended"},
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

	// "anything" counts whatever crosses, so the question must not name one kind
	// of it — this asked about vehicles over a pedestrian crossing.
	crossed := questionFor(domain.Claim{Kind: "crossings", Target: "anything"}, 180, "vehicles")
	if !strings.Contains(crossed, "180 things cross the count line") {
		t.Errorf("unexpected crossings question %q", crossed)
	}
	people := questionFor(domain.Claim{Kind: "crossings", Target: "person"}, 240, "vehicles")
	if !strings.Contains(people, "240 people cross the count line") {
		t.Errorf("a claim on people asked about something else: %q", people)
	}
}

func TestWatchableMeansASourceNotARelayPath(t *testing.T) {
	// The scheduler and the demotion sweep have to agree on what makes a stream
	// watchable. They disagreed: scheduling asked for source_url while demotion
	// asked for public_playback_id, so a submitted link qualified and was sent
	// straight back to Candidate before it could ever open a market.
	source, err := os.ReadFile("qualify.go")
	if err != nil {
		t.Fatal(err)
	}
	schedule, err := os.ReadFile("schedule.go")
	if err != nil {
		t.Fatal(err)
	}

	if strings.Contains(string(source), "btrim(public_playback_id)") {
		t.Error("demotion still requires a relay playback id, which submitted streams never have")
	}
	if !strings.Contains(string(source), "btrim(source_url)") {
		t.Error("demotion no longer checks for a source at all")
	}
	if !strings.Contains(string(schedule), "btrim(s.source_url)") {
		t.Error("scheduling no longer checks for a source at all")
	}
}

func TestTheQuestionNamesWhatIsActuallyCounted(t *testing.T) {
	cases := []struct {
		target, unit, want string
	}{
		// Counting everything must not claim to count one kind of thing: this
		// market asked about "vehicles" over a pedestrian crossing.
		{"anything", "vehicles", "things"},
		{"person", "vehicles", "people"},
		{"car", "people", "cars"},
		{"bicycle", "events", "bicycles"},
		// Nothing known about the target, so the stream's own unit stands.
		{"", "vehicles", "vehicles"},
	}
	for _, c := range cases {
		got := nounFor(domain.Claim{Kind: "crossings", Target: c.target}, c.unit)
		if got != c.want {
			t.Errorf("target %q with unit %q gave %q, want %q", c.target, c.unit, got, c.want)
		}
	}
}
