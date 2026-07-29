package store

import (
	"testing"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

func TestPrice(t *testing.T) {
	cases := []struct {
		name          string
		staked, total float64
		want, payout  float64
	}{
		{"no stake at all", 0, 0, 50, 2},
		{"majority", 5400, 8420, 64, 1.56},
		{"minority", 3020, 8420, 36, 2.79},
		{"whole pool one side", 100, 100, 100, 1},
		{"nothing on this side", 0, 8420, 0, 0},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, payout := price(c.staked, c.total)
			if got != c.want || payout != c.payout {
				t.Errorf("price(%v, %v) = %v, %v; want %v, %v",
					c.staked, c.total, got, payout, c.want, c.payout)
			}
		})
	}
}

func TestBalance(t *testing.T) {
	// 64.5 and 35.5 both round up and show as 101.
	os := balance([]domain.MarketOutcome{
		{ID: "yes", Probability: 65},
		{ID: "no", Probability: 36},
	})

	var sum float64
	for _, o := range os {
		sum += o.Probability
	}
	if sum != 100 {
		t.Fatalf("sum = %v, want 100", sum)
	}
	if os[0].Probability != 65 {
		t.Errorf("leading outcome moved to %v, drift belongs on the last", os[0].Probability)
	}
}

func TestBalanceSingleOutcome(t *testing.T) {
	os := balance([]domain.MarketOutcome{{ID: "yes", Probability: 73}})
	if len(os) != 1 || os[0].Probability != 73 {
		t.Fatalf("got %+v, want it untouched", os)
	}
}

func TestBalanceNil(t *testing.T) {
	if os := balance(nil); os == nil {
		t.Fatal("got nil, want [] so JSON isn't null")
	}
}

func TestPositionState(t *testing.T) {
	yes, no := "yes", "no"

	cases := []struct {
		name              string
		status, outcome   string
		won               *string
		claimed, refunded float64
		want              string
	}{
		{"open", "Open", "yes", nil, 0, 0, "Open"},
		{"observing", "Observing", "yes", nil, 0, 0, "Open"},
		{"invalid refunds everyone", "Invalid", "yes", nil, 0, 0, "Refundable"},
		{"invalid, already paid out", "Invalid", "yes", nil, 0, 25, "Refunded"},
		{"won", "Resolved", "yes", &yes, 0, 0, "Claimable"},
		{"won and claimed", "Resolved", "yes", &yes, 40, 0, "Claimed"},
		{"lost", "Resolved", "yes", &no, 0, 0, "Open"},
		{"resolved without a winner", "Resolved", "yes", nil, 0, 0, "Open"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := positionState(c.status, c.outcome, c.won, c.claimed, c.refunded)
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestObserverState(t *testing.T) {
	sig := "0xabc"

	cases := []struct {
		name string
		bad  []string
		sig  *string
		want string
	}{
		{"reporting", nil, nil, "Healthy"},
		{"signed off", nil, &sig, "Signed"},
		{"broke from consensus", []string{"observer_divergence"}, nil, "Disagreed"},
		{"disagreement beats a signature", []string{"observer_divergence"}, &sig, "Disagreed"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := observerState(c.bad, c.sig); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestRound(t *testing.T) {
	cases := []struct {
		in     float64
		places int
		want   float64
	}{
		{64.13301662707839, 0, 64},
		{1.5592592592592591, 2, 1.56},
		{99.6, 2, 99.6},
		{0, 2, 0},
	}

	for _, c := range cases {
		if got := round(c.in, c.places); got != c.want {
			t.Errorf("round(%v, %d) = %v, want %v", c.in, c.places, got, c.want)
		}
	}
}
