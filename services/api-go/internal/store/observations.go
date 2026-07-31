package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

// ErrNotObserving is returned when a report arrives for a market that is not in
// its observation window. Late reports are refused rather than backdated.
var ErrNotObserving = errors.New("market is not observing")

// SaveReport records one observer's reading. Observers may revise while the
// window is open, so the same observer writing twice replaces its own row and
// never adds a second vote.
func (s *Postgres) SaveReport(ctx context.Context, r domain.ObserverReport) error {
	var status string
	err := s.pool.QueryRow(ctx, `SELECT status FROM markets WHERE id = $1`, r.MarketID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("look up market: %w", err)
	}
	if status != "Observing" {
		return fmt.Errorf("%w: %s", ErrNotObserving, status)
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO observer_reports (
			market_id, observer_id, role, observed_value, confidence, model_version,
			uptime, maximum_timestamp_drift_ms, average_visibility,
			longest_frozen_seconds, invalid_reasons, signature, evidence_root, recorded_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (market_id, observer_id) DO UPDATE SET
			observed_value = EXCLUDED.observed_value,
			-- Provenance has to move with the value. A report claiming a model
			-- that did not produce it is worse than no report at all.
			role = EXCLUDED.role,
			model_version = EXCLUDED.model_version,
			confidence = EXCLUDED.confidence,
			uptime = EXCLUDED.uptime,
			maximum_timestamp_drift_ms = EXCLUDED.maximum_timestamp_drift_ms,
			average_visibility = EXCLUDED.average_visibility,
			longest_frozen_seconds = EXCLUDED.longest_frozen_seconds,
			invalid_reasons = EXCLUDED.invalid_reasons,
			signature = EXCLUDED.signature,
			evidence_root = EXCLUDED.evidence_root,
			recorded_at = EXCLUDED.recorded_at
		-- Observers retry inside a window, so a stream that drops out near the
		-- end would otherwise replace a good count with an empty one. A clean
		-- reading is never downgraded; a faulted one can still be corrected.
		WHERE cardinality(EXCLUDED.invalid_reasons) = 0
		   OR cardinality(observer_reports.invalid_reasons) > 0`,
		r.MarketID, r.ObserverID, r.Role, r.ObservedValue, r.Confidence, r.ModelVersion,
		r.Uptime, r.DriftMS, r.Visibility, r.FrozenSeconds,
		r.InvalidReasons, r.Signature, r.EvidenceRoot, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("save report: %w", err)
	}
	return nil
}

// SaveCounts appends the per-interval counts behind a report. These are the
// working record the evidence bundle is built from. Counts belong to the stream
// rather than the market, so the market only identifies which stream to file
// them against.
func (s *Postgres) SaveCounts(ctx context.Context, marketID, observerID string, counts []domain.CountSample) error {
	if len(counts) == 0 {
		return nil
	}

	var streamID string
	err := s.pool.QueryRow(ctx, `SELECT stream_id FROM markets WHERE id = $1`, marketID).Scan(&streamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve stream: %w", err)
	}
	rows := make([][]any, len(counts))
	for i, c := range counts {
		at, err := time.Parse(time.RFC3339Nano, c.ObservedAt)
		if err != nil {
			return fmt.Errorf("bad timestamp %q: %w", c.ObservedAt, err)
		}
		rows[i] = []any{streamID, observerID, at, c.Count, c.IntervalSeconds, c.Quality, c.ModelVersion}
	}

	_, err = s.pool.CopyFrom(ctx,
		pgx.Identifier{"count_observations"},
		[]string{"stream_id", "observer_id", "observed_at", "event_count",
			"interval_seconds", "stream_quality", "model_version"},
		pgx.CopyFromRows(rows))
	if err != nil {
		return fmt.Errorf("save counts: %w", err)
	}

	return s.saveSamples(ctx, marketID, observerID, counts)
}

// saveSamples keeps the same intervals a second time, in the order they were
// hashed into the evidence root. The stream-level counts are a rolling record
// and get compacted; a proof has to reproduce the exact leaves in the exact
// positions, which means storing them against the market that committed to them.
func (s *Postgres) saveSamples(ctx context.Context, marketID, observerID string, counts []domain.CountSample) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM observation_samples WHERE market_id = $1 AND observer_id = $2`,
		marketID, observerID)
	if err != nil {
		return fmt.Errorf("clear samples: %w", err)
	}

	rows := make([][]any, len(counts))
	for i, c := range counts {
		at, err := time.Parse(time.RFC3339Nano, c.ObservedAt)
		if err != nil {
			return fmt.Errorf("bad timestamp %q: %w", c.ObservedAt, err)
		}
		rows[i] = []any{marketID, observerID, i, at, c.Count, c.IntervalSeconds,
			c.Quality, c.ModelVersion, c.FrameDigest}
	}

	_, err = s.pool.CopyFrom(ctx,
		pgx.Identifier{"observation_samples"},
		[]string{"market_id", "observer_id", "leaf_index", "observed_at", "event_count",
			"interval_seconds", "stream_quality", "model_version", "frame_digest"},
		pgx.CopyFromRows(rows))
	if err != nil {
		return fmt.Errorf("save samples: %w", err)
	}
	return nil
}
