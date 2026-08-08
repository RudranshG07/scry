package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

// PendingQualification lists streams due another look. A link that qualified on
// submission can be offline, re-aimed or dark a week later, and a market on one
// can only ever void.
func (s *Postgres) PendingQualification(ctx context.Context, stale time.Duration) ([]domain.StreamSource, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, coalesce(source_url, ''), status, coalesce(default_claim, '{}'::jsonb)
		FROM streams
		WHERE coalesce(btrim(source_url), '') <> ''
		  AND (qualification->>'inspectedAt' IS NULL
		       OR (qualification->>'inspectedAt')::timestamptz < NOW() - $1::interval)
		ORDER BY id`, stale.String())
	if err != nil {
		return nil, fmt.Errorf("find streams due inspection: %w", err)
	}
	defer rows.Close()

	var out []domain.StreamSource
	for rows.Next() {
		var s domain.StreamSource
		if err := rows.Scan(&s.ID, &s.SourceURL, &s.Status, &s.Claim); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RecordQualification stores what an inspection found and moves the stream to
// match it. A stream nobody can count is suspended rather than left scheduling
// markets that cannot settle.
func (s *Postgres) RecordQualification(ctx context.Context, id string, v domain.Qualification) error {
	status := "Suspended"
	if v.Usable {
		status = "Qualified"
	}

	now := time.Now().UTC().Format(time.RFC3339)
	note, err := json.Marshal(map[string]any{
		"inspectedAt": now,
		// The engine's probation reads checkedAt, so a stream suspended here
		// recovers on the same clock as one suspended for disagreement. Without
		// it a camera that went quiet overnight would never be looked at again.
		"checkedAt":    now,
		"usable":       v.Usable,
		"reason":       v.Reason,
		"counts":       v.Counts,
		"subjects":     v.Subjects,
		"peak":         v.Peak,
		"disagreement": v.Disagreement,
		"provisional":  v.Provisional,
	})
	if err != nil {
		return err
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE streams
		SET status = $2, qualification = qualification || $3::jsonb, updated_at = NOW()
		WHERE id = $1`, id, status, note)
	if err != nil {
		return fmt.Errorf("record qualification: %w", err)
	}
	return nil
}
