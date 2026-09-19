package onchain

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/RudranshG07/scry/services/api-go/internal/chain"
	"github.com/RudranshG07/scry/services/api-go/internal/config"
)

// The worker's decisions are made in SQL and settled against a chain, so these
// run with both: a real database and the fake node from worker_test.go. Without
// a database they skip, which is what a local `go test` does.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("SCRY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no SCRY_TEST_DATABASE_URL")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func workerOn(t *testing.T, pool *pgxpool.Pool, n node) *Worker {
	t.Helper()
	signer, err := chain.NewSigner(testKey)
	if err != nil {
		t.Fatal(err)
	}
	return New(pool, slog.New(slog.NewTextHandler(io.Discard, nil)), signer, config.Chain{
		ID:       84532,
		RPC:      n.serve(t).URL,
		Book:     testBook,
		Resolver: testResolver,
	})
}

type seed struct {
	market       string
	status       string        // the engine's view, on markets
	deployment   string        // the chain's view, on market_deployments
	locksIn      time.Duration // negative for a window already closed
	challengeAgo time.Duration
}

func seedMarket(t *testing.T, pool *pgxpool.Pool, s seed) {
	t.Helper()
	stream := s.market + "-stream"
	exec := func(label, sql string, args ...any) {
		if _, err := pool.Exec(t.Context(), sql, args...); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
	}

	exec("stream", `
		INSERT INTO streams (id, name, category, status, region, timezone,
		                     qualification, created_at, updated_at, default_claim)
		VALUES ($1, 'Worker test camera', 'Traffic', 'Qualified', 'Test', 'UTC',
		        '{}', NOW(), NOW(), '{}')`, stream)

	locks := s.locksIn
	exec("market", `
		INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash,
		                     opens_at, locks_at, observation_starts_at, observation_ends_at,
		                     created_at, updated_at, claim_kind, claim_target, claim_options)
		VALUES ($1, $2, 84532, 'How many cars?', $3,
		        '0x00000000000000000000000000000000000000000000000000000000000000a1',
		        NOW() - INTERVAL '2 hours', NOW() + $4::interval, NOW() + $4::interval,
		        NOW() + $4::interval + INTERVAL '10 minutes',
		        NOW(), NOW(), 'count', 'cars', '{}')`,
		s.market, stream, s.status, locks.String())

	exec("outcomes", `
		INSERT INTO market_outcomes (market_id, outcome_id, label, minimum_value, maximum_value, sort_order)
		VALUES ($1, 'yes', 'Yes', 181, NULL, 0), ($1, 'no', 'No', NULL, 180, 1)`, s.market)

	// Requested is the only state that may name no contract.
	address := "'0x14efc6e56d5d345a098deefc07bb37e198a75846'"
	if s.deployment == "Requested" {
		address = "NULL"
	}
	challenge := "NULL"
	if s.challengeAgo != 0 {
		challenge = fmt.Sprintf("NOW() - INTERVAL '%d seconds'", int(s.challengeAgo.Seconds()))
	}
	exec("deployment", fmt.Sprintf(`
		INSERT INTO market_deployments (market_id, chain_id, state, contract_address,
		                                challenge_ends_at, attempts, requested_at, updated_at)
		VALUES ($1, 84532, $2, %s, %s, 0, NOW(), NOW() - INTERVAL '1 minute')`, address, challenge),
		s.market, s.deployment)

	t.Cleanup(func() {
		ctx := context.Background()
		for _, sql := range []string{
			`DELETE FROM market_deployments WHERE market_id = $1`,
			`DELETE FROM market_outcomes WHERE market_id = $1`,
			`DELETE FROM markets WHERE id = $1`,
		} {
			if _, err := pool.Exec(ctx, sql, s.market); err != nil {
				t.Errorf("clean up %s: %v", s.market, err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM streams WHERE id = $1`, stream); err != nil {
			t.Errorf("clean up %s: %v", stream, err)
		}
	})
}

func deploymentOf(t *testing.T, pool *pgxpool.Pool, market string) (state, note, address string) {
	t.Helper()
	var reason, contract *string
	err := pool.QueryRow(t.Context(), `
		SELECT state, last_error, contract_address FROM market_deployments
		WHERE market_id = $1 AND chain_id = 84532`, market).Scan(&state, &reason, &contract)
	if err != nil {
		t.Fatalf("read deployment: %v", err)
	}
	if reason != nil {
		note = *reason
	}
	if contract != nil {
		address = *contract
	}
	return state, note, address
}

func marketName(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}

func TestDeployOpensAMarketNobodyHasOpenedYet(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-deploy")
	seedMarket(t, pool, seed{market: market, status: "Open", deployment: "Requested", locksIn: 10 * time.Minute})

	n := healthy()
	n.ruleHash = 0 // the book has never held this market
	if err := workerOn(t, pool, n).deploy(t.Context()); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	state, _, address := deploymentOf(t, pool, market)
	if state != "Created" {
		t.Fatalf("state %q, want Created", state)
	}
	if address != testBook {
		t.Errorf("contract %q, want the book at %s", address, testBook)
	}
}

// Opening the same market twice reverts, so a book that already holds it is
// recorded rather than sent to again.
func TestDeployRecordsAMarketTheBookAlreadyHolds(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-held")
	seedMarket(t, pool, seed{market: market, status: "Open", deployment: "Requested", locksIn: 10 * time.Minute})

	n := healthy()
	n.ruleHash = 1 // a rule hash means the market is already on the book
	if err := workerOn(t, pool, n).deploy(t.Context()); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	if state, _, _ := deploymentOf(t, pool, market); state != "Created" {
		t.Fatalf("state %q, want Created", state)
	}
}

// A market that locks before its contract could be mined is money nobody can
// stake, so it is failed rather than deployed into a closed window.
func TestDeployRefusesAMarketAboutToLock(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-late")
	seedMarket(t, pool, seed{market: market, status: "Open", deployment: "Requested", locksIn: 5 * time.Second})

	n := healthy()
	n.ruleHash = 0
	if err := workerOn(t, pool, n).deploy(t.Context()); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	state, note, _ := deploymentOf(t, pool, market)
	if state != "Failed" {
		t.Fatalf("state %q, want Failed", state)
	}
	if note == "" {
		t.Error("nothing recorded about why it was not deployed")
	}
}

func TestVoidAcceptsAMarketAlreadyVoidOnChain(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-void")
	seedMarket(t, pool, seed{market: market, status: "Invalid", deployment: "Created", locksIn: -time.Hour})

	n := healthy()
	n.marketStatus = marketInvalid
	if err := workerOn(t, pool, n).void(t.Context()); err != nil {
		t.Fatalf("void: %v", err)
	}

	state, note, _ := deploymentOf(t, pool, market)
	if state != "Voided" {
		t.Fatalf("state %q, want Voided", state)
	}
	if note != "already void on chain" {
		t.Errorf("note %q, want the chain's own answer", note)
	}
}

// Nothing staked means nothing to refund, and no transaction worth its gas.
func TestVoidRecordsAMarketNobodyStaked(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-unfunded")
	seedMarket(t, pool, seed{market: market, status: "Invalid", deployment: "Created", locksIn: -time.Hour})

	n := healthy()
	n.marketStatus = 1 // open on chain, neither resolved nor void
	n.totalPool = 0
	if err := workerOn(t, pool, n).void(t.Context()); err != nil {
		t.Fatalf("void: %v", err)
	}

	state, note, _ := deploymentOf(t, pool, market)
	if state != "Unfunded" {
		t.Fatalf("state %q, want Unfunded", state)
	}
	if note != "nobody took a position" {
		t.Errorf("note %q", note)
	}
}

// A staked market that cannot settle is voided on chain so every stake returns.
func TestVoidSendsForAMarketThatWasStaked(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-refund")
	seedMarket(t, pool, seed{market: market, status: "Invalid", deployment: "Created", locksIn: -time.Hour})

	n := healthy()
	n.marketStatus = 1
	n.totalPool = 100_000_000
	if err := workerOn(t, pool, n).void(t.Context()); err != nil {
		t.Fatalf("void: %v", err)
	}

	state, note, _ := deploymentOf(t, pool, market)
	if state != "Voided" {
		t.Fatalf("state %q, want Voided", state)
	}
	if note != "observation invalid" {
		t.Errorf("note %q, want the reason the engine gave", note)
	}
}

// An observer challenged the reading inside the window, so the market voids
// instead of finalizing, and it takes no transaction to notice.
func TestFinalizeVoidsAChallengedResult(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-challenged")
	seedMarket(t, pool, seed{
		market: market, status: "Result proposed", deployment: "Proposed",
		locksIn: -time.Hour, challengeAgo: time.Minute,
	})

	n := healthy()
	n.observation = observationChallenged
	if err := workerOn(t, pool, n).finalize(t.Context()); err != nil {
		t.Fatalf("finalize: %v", err)
	}

	state, note, _ := deploymentOf(t, pool, market)
	if state != "Voided" {
		t.Fatalf("state %q, want Voided", state)
	}
	if note != "voided on chain" {
		t.Errorf("note %q", note)
	}
}

func TestFinalizeSettlesAResultNobodyChallenged(t *testing.T) {
	pool := testPool(t)
	market := marketName("worker-final")
	seedMarket(t, pool, seed{
		market: market, status: "Resolved", deployment: "Proposed",
		locksIn: -time.Hour, challengeAgo: time.Minute,
	})

	n := healthy()
	n.observation = observationProposed
	n.marketStatus = marketResolved
	if err := workerOn(t, pool, n).finalize(t.Context()); err != nil {
		t.Fatalf("finalize: %v", err)
	}

	if state, _, _ := deploymentOf(t, pool, market); state != "Finalized" {
		t.Fatalf("state %q, want Finalized", state)
	}
}
