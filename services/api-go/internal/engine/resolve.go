package engine

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

const (
	minObservers = domain.ObserversRequired

	tolerancePercent = 0.20
	toleranceFloor   = 2
	challengeWindow  = 10 * time.Minute
	reportGrace      = 60 * time.Second
)

type band struct {
	id       string
	min, max *int64
}

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

	value, agreeing, agreed := consensus(counts, minObservers)
	if !agreed {
		return e.invalidate(ctx, id, len(counts), "observers did not agree")
	}

	bands, err := e.bands(ctx, id)
	if err != nil {
		return err
	}
	outcome, ok := winner(value, bands)
	if !ok {
		return e.invalidate(ctx, id, len(counts), "no outcome covers the count")
	}
	// Two counts close enough to agree can still answer the question opposite
	// ways: 118 and 124 against a bar of 120 are five per cent apart and settle
	// against each other. Refund rather than pay out on the higher reading.
	if split(agreeing, bands, outcome) {
		return e.invalidate(ctx, id, len(counts), "observers split across the bar")
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

func (e *Engine) invalidate(ctx context.Context, id string, reporting int, reason string) error {
	_, err := e.pool.Exec(ctx, `
		UPDATE markets SET status = 'Invalid', updated_at = NOW()
		WHERE id = $1 AND status = 'Observing'`, id)
	if err != nil {
		return fmt.Errorf("invalidate: %w", err)
	}
	e.log.Warn("market invalidated", "market", id, "reason", reason,
		"observers", reporting, "needed", minObservers)
	e.notify(ctx, id, "Invalid")
	return nil
}

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

func allowedSpread(base int64) int64 {
	scaled := int64(math.Ceil(float64(base) * tolerancePercent))
	return max(toleranceFloor, scaled)
}

// consensus is the value the agreeing observers settle on, with the readings
// that agreed, so the caller can check they all answer the question the same way.
func consensus(counts []int64, need int) (int64, []int64, bool) {
	if len(counts) < need {
		return 0, nil, false
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
		return 0, nil, false
	}
	return best[len(best)/2], best, true
}

// split reports whether the readings that agreed do not all land in the band the
// result settles on.
func split(counts []int64, bands []band, outcome string) bool {
	for _, count := range counts {
		side, ok := winner(count, bands)
		if !ok || side != outcome {
			return true
		}
	}
	return false
}

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
