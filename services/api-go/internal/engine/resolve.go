package engine

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	// Two of three observers must land on the same number for a result to stand.
	minObservers = 2
	// Proportional: a fixed margin is too tight at 200 and too loose at 5.
	tolerancePercent = 0.05
	toleranceFloor   = 2
	// How long anyone has to challenge a proposed result.
	challengeWindow = 10 * time.Minute
	// An observer covers the window to its last second, so its report is only in
	// flight once the window has closed.
	reportGrace = 60 * time.Second
)

type band struct {
	id       string
	min, max *int64
}

// propose closes observation and either publishes a result or voids the market.
// No quorum means invalid, not zero.
func (e *Engine) propose(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		SELECT id FROM markets
		WHERE status = 'Observing' AND observation_ends_at <= NOW() - $1::interval`,
		reportGrace.String())
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

	value, agreed := consensus(counts, minObservers)
	if !agreed {
		return e.invalidate(ctx, id, len(counts))
	}

	bands, err := e.bands(ctx, id)
	if err != nil {
		return err
	}
	outcome, ok := winner(value, bands)
	if !ok {
		return e.invalidate(ctx, id, len(counts))
	}

	root, err := e.evidenceRoot(ctx, id, value)
	if err != nil {
		return err
	}

	_, err = e.pool.Exec(ctx, `
		UPDATE markets
		SET status = 'Result proposed', observed_value = $2, winning_outcome_id = $3,
		    evidence_root = $5, challenge_ends_at = NOW() + $4::interval, updated_at = NOW()
		WHERE id = $1 AND status = 'Observing'`,
		id, value, outcome, challengeWindow.String(), root)
	if err != nil {
		return fmt.Errorf("propose result: %w", err)
	}

	e.log.Info("result proposed", "market", id, "value", value, "outcome", outcome,
		"observers", len(counts), "evidence", root)
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

// evidenceRoot takes the bundle of an observer who reported the settled value;
// anyone else's would point later proofs at intervals that do not add up.
func (e *Engine) evidenceRoot(ctx context.Context, id string, value int64) (*string, error) {
	var root *string
	err := e.pool.QueryRow(ctx, `
		SELECT evidence_root FROM observer_reports
		WHERE market_id = $1 AND observed_value = $2
		  AND cardinality(invalid_reasons) = 0 AND evidence_root IS NOT NULL
		ORDER BY observer_id
		LIMIT 1`, id, value).Scan(&root)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read evidence root: %w", err)
	}
	return root, nil
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

// allowedSpread is how far apart two counts can be and still agree.
func allowedSpread(base int64) int64 {
	scaled := int64(math.Ceil(float64(base) * tolerancePercent))
	return max(toleranceFloor, scaled)
}

// consensus returns the median of the largest agreeing group. Outliers are
// dropped rather than averaged in.
func consensus(counts []int64, need int) (int64, bool) {
	if len(counts) < need {
		return 0, false
	}

	sorted := append([]int64(nil), counts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	var best []int64
	for i := range sorted {
		spread := allowedSpread(sorted[i])
		var group []int64
		for _, v := range sorted[i:] {
			if v-sorted[i] > spread {
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

// winner picks the outcome whose band contains the value; exactly one must match.
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
