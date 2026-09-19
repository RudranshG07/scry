package store

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

// These run against a real database because the queries are the thing worth
// testing. A fake would answer whatever the test expected, which is how a
// losing position reported itself as Open for so long.
func testStore(t *testing.T) *Postgres {
	t.Helper()
	dsn := os.Getenv("SCRY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no SCRY_TEST_DATABASE_URL")
	}
	pg, err := NewPostgres(t.Context(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pg.pool.Close)
	return pg
}

// A resolved market on one chain, its two outcomes, and the deployment state
// the portfolio reads a position's fate from.
func seedResolved(t *testing.T, pg *Postgres, market string, chain int64, state, winner string) {
	t.Helper()
	stream := market + "-stream"
	exec := func(label, sql string, args ...any) {
		if _, err := pg.pool.Exec(t.Context(), sql, args...); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
	}

	// Alone among these, markets.stream_id does not cascade, so its stream is
	// created first and removed last.
	exec("stream", `
		INSERT INTO streams (id, name, category, status, region, timezone,
		                     qualification, created_at, updated_at, default_claim)
		VALUES ($1, 'Portfolio test camera', 'Traffic', 'Qualified', 'Test', 'UTC',
		        '{}', NOW(), NOW(), '{}')`, stream)

	exec("market", `
		INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash,
		                     opens_at, locks_at, observation_starts_at, observation_ends_at,
		                     winning_outcome_id, observed_value, created_at, updated_at,
		                     claim_kind, claim_target, claim_options)
		VALUES ($1, $4, $2, 'How many cars?', 'Resolved',
		        '0x00000000000000000000000000000000000000000000000000000000000000a1',
		        NOW() - INTERVAL '1 hour', NOW() - INTERVAL '30 minutes',
		        NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '10 minutes',
		        $3, 214, NOW(), NOW(), 'count', 'cars', '{}')`, market, chain, winner, stream)

	exec("outcomes", `
		INSERT INTO market_outcomes (market_id, outcome_id, label, sort_order)
		VALUES ($1, 'yes', 'Yes', 0), ($1, 'no', 'No', 1)`, market)

	// Anything past Requested has to name the contract it reached: the schema
	// refuses a settled deployment that points at nothing.
	exec("deployment", `
		INSERT INTO market_deployments (market_id, chain_id, state, contract_address,
		                                attempts, requested_at, updated_at)
		VALUES ($1, $2, $3, '0x14efc6e56d5d345a098deefc07bb37e198a75846', 0, NOW(), NOW())`,
		market, chain, state)

	// Not t.Context(): it is cancelled before cleanups run, so every delete
	// here would fail and leave the rows behind.
	t.Cleanup(func() {
		ctx := context.Background()
		for _, sql := range []string{
			`DELETE FROM projected_positions WHERE market_id = $1`,
			`DELETE FROM market_deployments WHERE market_id = $1`,
			`DELETE FROM market_outcomes WHERE market_id = $1`,
			`DELETE FROM markets WHERE id = $1`,
		} {
			if _, err := pg.pool.Exec(ctx, sql, market); err != nil {
				t.Errorf("clean up %s: %v", market, err)
			}
		}
		if _, err := pg.pool.Exec(ctx, `DELETE FROM streams WHERE id = $1`, stream); err != nil {
			t.Errorf("clean up %s: %v", stream, err)
		}
	})
}

func stake(t *testing.T, pg *Postgres, market string, chain int64, account, outcome string, micros int64) {
	t.Helper()
	_, err := pg.pool.Exec(t.Context(), `
		INSERT INTO projected_positions (market_id, chain_id, account, outcome_id,
		                                 amount, claimed_amount, refunded_amount, updated_at)
		VALUES ($1, $2, $3, $4, $5, 0, 0, NOW())`, market, chain, account, outcome, micros)
	if err != nil {
		t.Fatalf("stake %s on %s: %v", account, outcome, err)
	}
}

// The bug this pins: a settled market that paid somebody else left the losing
// position reading Open, beside an estimated return it was never going to get.
func TestPortfolioSeparatesAWinFromALoss(t *testing.T) {
	pg := testStore(t)
	market := fmt.Sprintf("portfolio-test-%d", time.Now().UnixNano())
	const chain = int64(84532)
	const account = "0x00000000000000000000000000000000000000a1"

	seedResolved(t, pg, market, chain, "Finalized", "yes")
	stake(t, pg, market, chain, account, "yes", 60_000_000)
	stake(t, pg, market, chain, account, "no", 40_000_000)

	portfolio, err := pg.GetPortfolio(t.Context(), account)
	if err != nil {
		t.Fatalf("portfolio: %v", err)
	}
	if len(portfolio.Positions) != 2 {
		t.Fatalf("got %d positions, want 2", len(portfolio.Positions))
	}

	for _, position := range portfolio.Positions {
		switch position.OutcomeLabel {
		case "Yes":
			if position.State != "Claimable" {
				t.Errorf("the winning side reads %q, want Claimable", position.State)
			}
			// The whole pool divided in proportion: 60 staked of the 100 in the
			// market, with nobody else on the winning side.
			if position.EstimatedReturn != 100 {
				t.Errorf("the winner is owed %v, want 100", position.EstimatedReturn)
			}
		case "No":
			if position.State != "Lost" {
				t.Errorf("the losing side reads %q, want Lost", position.State)
			}
			if position.EstimatedReturn != 0 {
				t.Errorf("the losing side is owed %v, want nothing", position.EstimatedReturn)
			}
		default:
			t.Errorf("unexpected outcome %q", position.OutcomeLabel)
		}
	}

	if portfolio.TotalPositioned != 100 {
		t.Errorf("total positioned %v, want 100", portfolio.TotalPositioned)
	}
	// Only what can actually be collected: a loss must not inflate this.
	if portfolio.Claimable != 100 {
		t.Errorf("claimable %v, want 100", portfolio.Claimable)
	}
}

// A voided market refunds every side, so neither position is a loss.
func TestPortfolioRefundsBothSidesOfAVoidedMarket(t *testing.T) {
	pg := testStore(t)
	market := fmt.Sprintf("portfolio-void-%d", time.Now().UnixNano())
	const chain = int64(84532)
	const account = "0x00000000000000000000000000000000000000b2"

	seedResolved(t, pg, market, chain, "Voided", "yes")
	stake(t, pg, market, chain, account, "yes", 60_000_000)
	stake(t, pg, market, chain, account, "no", 40_000_000)

	portfolio, err := pg.GetPortfolio(t.Context(), account)
	if err != nil {
		t.Fatalf("portfolio: %v", err)
	}
	for _, position := range portfolio.Positions {
		if position.State != "Refundable" {
			t.Errorf("%s reads %q, want Refundable", position.OutcomeLabel, position.State)
		}
		if position.EstimatedReturn != position.Amount {
			t.Errorf("%s refunds %v against a stake of %v", position.OutcomeLabel, position.EstimatedReturn, position.Amount)
		}
	}
	if portfolio.Claimable != 100 {
		t.Errorf("claimable %v, want the whole stake back", portfolio.Claimable)
	}
}
