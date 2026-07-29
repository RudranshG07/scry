package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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
}

var units = map[string]string{
	"Traffic":    "vehicles",
	"Parking":    "arrivals",
	"Queues":     "people",
	"Operations": "items",
	"Footfall":   "people",
	"Mobility":   "vehicles",
}

// schedule keeps one market in flight per qualified stream. A stream with
// nothing scheduled, open, locked or observing gets its next window.
func (e *Engine) schedule(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		SELECT s.id, s.category,
		       COALESCE((s.qualification->>'threshold')::bigint, 180)
		FROM streams s
		WHERE s.status = 'Qualified'
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
		if err := rows.Scan(&p.id, &p.category, &p.threshold); err != nil {
			return err
		}
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
	unit := units[p.category]
	if unit == "" {
		unit = "events"
	}
	question := fmt.Sprintf("Will more than %d %s cross the count line during the observation window?",
		p.threshold, unit)

	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash,
		                     opens_at, locks_at, observation_starts_at, observation_ends_at)
		VALUES ($1, $2, $3, $4, 'Scheduled', $5, $6, $7, $7, $8)`,
		id, p.id, baseChainID, question, ruleHash(id, p.threshold, ends), opens, locks, ends)
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
