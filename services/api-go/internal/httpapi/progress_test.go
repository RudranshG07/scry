package httpapi

import (
	"testing"
	"time"
)

func TestRunningCountsExpireWithTheObserversThatSentThem(t *testing.T) {
	board := newProgressBoard()
	board.record("market-1", liveCount{ObserverID: "verify-01", Count: 40, Elapsed: 60, At: time.Now()})
	board.record("market-1", liveCount{ObserverID: "vision-01", Count: 44, Elapsed: 60, At: time.Now()})

	live := board.of("market-1")
	if len(live) != 2 {
		t.Fatalf("got %d counts, want both observers", len(live))
	}
	if live[0].ObserverID != "verify-01" {
		t.Errorf("counts came back as %s first; they should be in a stable order", live[0].ObserverID)
	}

	board.record("market-1", liveCount{ObserverID: "verify-01", Count: 40, Elapsed: 60,
		At: time.Now().Add(-2 * progressFresh)})
	if live := board.of("market-1"); len(live) != 1 || live[0].ObserverID != "vision-01" {
		t.Errorf("a stale count was still shown: %+v", live)
	}
}

func TestAMarketNobodyIsCountingIsForgotten(t *testing.T) {
	board := newProgressBoard()
	board.record("market-1", liveCount{ObserverID: "vision-01", At: time.Now().Add(-2 * progressFresh)})
	board.record("market-2", liveCount{ObserverID: "vision-01", At: time.Now()})

	if _, held := board.counts["market-1"]; held {
		t.Error("a market whose observers all went quiet is still held in memory")
	}
	if len(board.of("market-2")) != 1 {
		t.Error("the live market was forgotten too")
	}
}

func TestRateIsPerMinuteOfWhatWasCounted(t *testing.T) {
	cases := []struct {
		count   int64
		elapsed float64
		want    float64
	}{
		{120, 60, 120},
		{60, 120, 30},
		{7, 0, 0},
		{0, 60, 0},
	}
	for _, c := range cases {
		if got := perMinute(c.count, c.elapsed); got != c.want {
			t.Errorf("perMinute(%d, %v) = %v, want %v", c.count, c.elapsed, got, c.want)
		}
	}
}
