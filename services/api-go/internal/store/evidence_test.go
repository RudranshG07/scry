package store

import (
	"encoding/hex"
	"testing"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		panic(err)
	}
	return t
}

func sample(count int64, when string) domain.EvidenceSample {
	return domain.EvidenceSample{
		ObservedAt: at(when), Count: count, IntervalSeconds: 60,
		ModelVersion: "mog2-centroid/0.1-primary", FrameDigest: "abc",
	}
}

// Roots computed by scry_vision/evidence.py over the same intervals. If these
// ever diverge, every proof served here fails against the root the observer
// actually published, and the failure is silent on both sides.
func TestRootMatchesTheObserver(t *testing.T) {
	cases := []struct {
		name  string
		input []domain.EvidenceSample
		want  string
	}{
		{"one interval", []domain.EvidenceSample{
			sample(3, "2026-07-31T06:00:00.000000Z"),
		}, "0x8823bc472b63b33ef5727112f70e886986db2b3f54c4ebe970b6add58bfdc627"},
		{"two intervals", []domain.EvidenceSample{
			sample(3, "2026-07-31T06:00:00.000000Z"),
			sample(5, "2026-07-31T06:01:00.000000Z"),
		}, "0x65dab3234a4a79a30be4cbf65240fc2eb74a6c20597fdaf34a211b9de0e68380"},
		{"odd count carries the last node", []domain.EvidenceSample{
			sample(3, "2026-07-31T06:00:00.000000Z"),
			sample(5, "2026-07-31T06:01:00.000000Z"),
			sample(2, "2026-07-31T06:02:00.000000Z"),
		}, "0xd45317dc605eac7b27a5fc17600e96b0253e59af90863ca88bdd5c94eab3064d"},
	}

	for _, c := range cases {
		var leaves [][]byte
		for _, s := range c.input {
			leaves = append(leaves, leafFor(s))
		}
		if got := rootOf(leaves); got != c.want {
			t.Errorf("%s: go root %s, python root %s", c.name, got, c.want)
		}
	}
}

func TestEveryIntervalProvesAgainstTheRoot(t *testing.T) {
	for _, n := range []int{1, 2, 3, 5, 8, 11} {
		var leaves [][]byte
		for i := 0; i < n; i++ {
			leaves = append(leaves, leafFor(sample(int64(i), "2026-07-31T06:00:00.000000Z")))
		}
		root := rootOf(leaves)
		for i := 0; i < n; i++ {
			running := leaves[i]
			for _, sib := range pathTo(leaves, i) {
				other, err := hex.DecodeString(sib)
				if err != nil {
					t.Fatal(err)
				}
				running = pair(running, other)
			}
			if "0x"+hex.EncodeToString(running) != root {
				t.Errorf("n=%d leaf=%d did not prove against the root", n, i)
			}
		}
	}
}

func TestNoIntervalsIsNotACommitment(t *testing.T) {
	if rootOf(nil) != "" {
		t.Error("a root over no evidence must not look like a real commitment")
	}
}
