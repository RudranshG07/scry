package engine

import (
	"context"
	"fmt"
)

// Probability only moves when someone takes a position, so sampling on a fixed
// grid gives the chart an even x-axis. The primary key on
// (market, source, recorded_at) makes the write idempotent, so a second engine
// filling the same bucket is a no-op rather than a duplicate.
const historyBucket = 30 // seconds

// An empty pool is not missing data — it is a market nobody has taken a side on,
// which is exactly even. Recording it keeps the chart continuous from the moment
// a market opens.
const evenOdds = 0.5

func (e *Engine) history(ctx context.Context) error {
	_, err := e.pool.Exec(ctx, fmt.Sprintf(`
		INSERT INTO market_probability_history (market_id, source, recorded_at, probability, sample_size)
		SELECT m.id,
		       'market',
		       to_timestamp(floor(extract(epoch FROM NOW()) / %d) * %d),
		       LEAST(0.999, GREATEST(0.001, COALESCE((
		           SELECT SUM(p.amount) FILTER (WHERE p.outcome_id = lead.outcome_id)::float8
		                  / NULLIF(SUM(p.amount), 0)::float8
		           FROM projected_positions p
		           WHERE p.market_id = m.id
		       ), %v))),
		       (SELECT COUNT(DISTINCT account) FROM projected_positions WHERE market_id = m.id)
		FROM markets m
		CROSS JOIN LATERAL (
		    SELECT outcome_id FROM market_outcomes o
		    WHERE o.market_id = m.id ORDER BY o.sort_order LIMIT 1
		) lead
		WHERE m.status IN ('Open', 'Locked', 'Observing')
		ON CONFLICT (market_id, source, recorded_at) DO NOTHING`,
		historyBucket, historyBucket, evenOdds))
	if err != nil {
		return fmt.Errorf("record probability: %w", err)
	}
	return nil
}
