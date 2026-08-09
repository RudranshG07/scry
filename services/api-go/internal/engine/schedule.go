package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

const (
	baseChainID = 8453
	// Gap between one market settling and the next opening, so a room is never
	// mid-window when a user arrives.
	restBetweenMarkets = 2 * time.Minute
	openWindow         = 8 * time.Minute
	observeWindow      = 15 * time.Minute
)

type streamPlan struct {
	id        string
	category  string
	threshold int64
	claim     domain.Claim
}

// observable reports whether anything can actually count this claim. A market
// carrying a claim no observer supports is skipped by every worker and expires
// Invalid, which is how 218 markets on a working camera settled at nothing: the
// crossings observer needs the line the submitter drew, and the scheduler was
// leaving it empty.
func observable(c domain.Claim) bool {
	switch c.Kind {
	case "crossings":
		line, ok := c.Options["line"].([]any)
		return ok && len(line) == 2
	case "phrase", "objects":
		return c.Target != ""
	default:
		return false
	}
}

func questionFor(c domain.Claim, threshold int64, unit string) string {
	switch c.Kind {
	case "phrase":
		return fmt.Sprintf("Will %q be said more than %d times during the observation window?",
			c.Target, threshold)
	case "objects":
		return fmt.Sprintf("Will more than %d %s be counted during the observation window?",
			threshold, c.Target)
	default:
		return fmt.Sprintf("Will more than %d %s cross the count line during the observation window?",
			threshold, unit)
	}
}

// schedule keeps one market in flight per qualified stream. A stream with
// nothing scheduled, open, locked or observing gets its next window.
func (e *Engine) schedule(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		SELECT s.id, s.category,
		       COALESCE((s.qualification->>'threshold')::bigint, 180),
		       COALESCE(s.default_claim, '{}'::jsonb)
		FROM streams s
		WHERE s.status = 'Qualified'
		  -- A stream with no source cannot be observed, so a market on it could
		  -- only ever invalidate. Do not open one. An unset source reaches us as
		  -- both NULL and empty text, and empty passes IS NOT NULL.
		  --
		  -- This asks for source_url rather than the relay's playback id, which
		  -- a submitted link never has: observers and the player both resolve
		  -- source_url now, so a stream with one is watchable whether or not the
		  -- relay ever republishes it.
		  AND coalesce(btrim(s.source_url), '') <> ''
		  -- On a quiet camera a single subject moves the count by more than the
		  -- agreement bar, so a result there turns on rounding rather than on
		  -- what anyone observed. The stream stays watchable; it just does not
		  -- take positions until there is enough happening to settle honestly.
		  AND coalesce((s.qualification->>'provisional')::boolean, false) = false
		  AND NOT EXISTS (
		      SELECT 1 FROM markets m
		      WHERE m.stream_id = s.id
		        AND m.status IN ('Scheduled', 'Open', 'Locked', 'Observing')
		  )`)
	if err != nil {
		return fmt.Errorf("find idle streams: %w", err)
	}
	defer rows.Close()

	var plans []streamPlan
	for rows.Next() {
		var p streamPlan
		if err := rows.Scan(&p.id, &p.category, &p.threshold, &p.claim); err != nil {
			return err
		}
		if !observable(p.claim) {
			if !e.warned[p.id] {
				e.warned[p.id] = true
				e.log.Warn("stream has no claim anything can count, not scheduling",
					"stream", p.id, "claim", p.claim.Label())
			}
			continue
		}
		delete(e.warned, p.id)
		plans = append(plans, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range plans {
		if err := e.create(ctx, p); err != nil {
			e.log.Error("could not schedule market", "stream", p.id, "error", err)
		}
	}
	return nil
}

func (e *Engine) create(ctx context.Context, p streamPlan) error {
	opens := time.Now().UTC().Add(restBetweenMarkets).Truncate(time.Second)
	locks := opens.Add(openWindow)
	ends := locks.Add(observeWindow)

	id := fmt.Sprintf("%s-%d", p.id, opens.Unix())
	question := questionFor(p.claim, p.threshold, domain.UnitFor(p.category))

	options := []byte("{}")
	if len(p.claim.Options) > 0 {
		encoded, err := json.Marshal(p.claim.Options)
		if err != nil {
			return fmt.Errorf("encode claim options: %w", err)
		}
		options = encoded
	}

	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash,
		                     opens_at, locks_at, observation_starts_at, observation_ends_at,
		                     claim_kind, claim_target, claim_options)
		VALUES ($1, $2, $3, $4, 'Scheduled', $5, $6, $7, $7, $8, $9, $10, $11)`,
		id, p.id, baseChainID, question, ruleHash(id, p.threshold, ends), opens, locks, ends,
		p.claim.Kind, p.claim.Target, options)
	if err != nil {
		return fmt.Errorf("insert market: %w", err)
	}

	above := p.threshold + 1
	outcomes := [][]any{
		{id, "yes", fmt.Sprintf("Yes, above %d", p.threshold), &above, nil, 0},
		{id, "no", fmt.Sprintf("No, %d or below", p.threshold), nil, &p.threshold, 1},
	}
	_, err = tx.CopyFrom(ctx,
		pgx.Identifier{"market_outcomes"},
		[]string{"market_id", "outcome_id", "label", "minimum_value", "maximum_value", "sort_order"},
		pgx.CopyFromRows(outcomes))
	if err != nil {
		return fmt.Errorf("insert outcomes: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	e.log.Info("market scheduled", "market", id, "stream", p.id, "opens", opens.Format(time.RFC3339))
	return nil
}

// ruleHash commits the parts of the rule a result must be checked against. It
// is written before the market opens and never changes.
func ruleHash(id string, threshold int64, ends time.Time) string {
	sum := sha256.Sum256(fmt.Appendf(nil, "%s|%d|%d", id, threshold, ends.Unix()))
	return "0x" + hex.EncodeToString(sum[:])
}
