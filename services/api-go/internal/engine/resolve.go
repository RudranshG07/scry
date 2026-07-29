package engine

import (
	"context"
	"fmt"
	"sort"
	"time"
)

const (
	// Two of three observers must land on the same number for a result to stand.
	minObservers = 2
	// How far apart two counts can be and still count as agreement.
	tolerance = 2
	// How long anyone has to challenge a proposed result.
	challengeWindow = 10 * time.Minute
)

type band struct {
	id       string
	min, max *int64
}

// propose closes observation and either publishes a result or voids the market.
// A market with no quorum is invalid, not zero — refusing to answer is a valid
// outcome and the safest one.
func (e *Engine) propose(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		SELECT id FROM markets
		WHERE status = 'Observing' AND observation_ends_at <= NOW()`)
	if err != nil {
		return fmt.Errorf("find ended observations: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range ids {
		if err := e.resolveOne(ctx, id); err != nil {
			e.log.Error("resolution failed", "market", id, "error", err)
		}
	}
	return nil
}

func (e *Engine) resolveOne(ctx context.Context, id string) error {
	counts, err := e.reportedCounts(ctx, id)
	if err != nil {
		return err
	}

	value, agreed := consensus(counts, tolerance, minObservers)
	if !agreed {
		return e.invalidate(ctx, id, len(counts))
	}

	bands, err := e.bands(ctx, id)
	if err != nil {
		return err
	}
	outcome, ok := winner(value, bands)
	if !ok {
		// A count nothing covers means the rule and the reading disagree.
		return e.invalidate(ctx, id, len(counts))
	}

	_, err = e.pool.Exec(ctx, `
		UPDATE markets
		SET status = 'Result proposed', observed_value = $2, winning_outcome_id = $3,
		    challenge_ends_at = NOW() + $4::interval, updated_at = NOW()
		WHERE id = $1 AND status = 'Observing'`,
		id, value, outcome, challengeWindow.String())
	if err != nil {
		return fmt.Errorf("propose result: %w", err)
	}

	e.log.Info("result proposed", "market", id, "value", value, "outcome", outcome, "observers", len(counts))
	e.notify(ctx, id, "Result proposed")
	return nil
}

func (e *Engine) invalidate(ctx context.Context, id string, reporting int) error {
	_, err := e.pool.Exec(ctx, `
		UPDATE markets SET status = 'Invalid', updated_at = NOW()
		WHERE id = $1 AND status = 'Observing'`, id)
	if err != nil {
		return fmt.Errorf("invalidate: %w", err)
	}
	e.log.Warn("market invalidated", "market", id, "observers", reporting, "needed", minObservers)
	e.notify(ctx, id, "Invalid")
	return nil
}

func (e *Engine) reportedCounts(ctx context.Context, id string) ([]int64, error) {
	rows, err := e.pool.Query(ctx, `
		SELECT observed_value FROM observer_reports
		WHERE market_id = $1 AND cardinality(invalid_reasons) = 0`, id)
	if err != nil {
		return nil, fmt.Errorf("read reports: %w", err)
	}
	defer rows.Close()

	var out []int64
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (e *Engine) bands(ctx context.Context, id string) ([]band, error) {
	rows, err := e.pool.Query(ctx, `
		SELECT outcome_id, minimum_value, maximum_value
		FROM market_outcomes WHERE market_id = $1 ORDER BY sort_order`, id)
	if err != nil {
		return nil, fmt.Errorf("read bands: %w", err)
	}
	defer rows.Close()

	var out []band
	for rows.Next() {
		var b band
		if err := rows.Scan(&b.id, &b.min, &b.max); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// consensus finds the largest group of observers within tolerance of each other
// and returns their median. Outliers are dropped rather than averaged in, so one
// broken camera cannot drag the result.
func consensus(counts []int64, tolerance int64, need int) (int64, bool) {
	if len(counts) < need {
		return 0, false
	}

	sorted := append([]int64(nil), counts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	var best []int64
	for i := range sorted {
		var group []int64
		for _, v := range sorted[i:] {
			if v-sorted[i] > tolerance {
				break
			}
			group = append(group, v)
		}
		if len(group) > len(best) {
			best = group
		}
	}

	if len(best) < need {
		return 0, false
	}
	return best[len(best)/2], true
}

// winner picks the outcome whose band contains the value. Exactly one must
// match: overlapping or gapped bands are a rule the market cannot settle.
func winner(value int64, bands []band) (string, bool) {
	var found string
	hits := 0
	for _, b := range bands {
		if b.min != nil && value < *b.min {
			continue
		}
		if b.max != nil && value > *b.max {
			continue
		}
		found = b.id
		hits++
	}
	if hits != 1 {
		return "", false
	}
	return found, true
}
