package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

// StreamID is derived from the link so the same camera submitted twice is the
// same stream. The slug is there to make logs readable; the digest is what
// makes it unique.
func StreamID(name, sourceURL string) string {
	slug := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		case r == ' ', r == '-', r == '_':
			return '-'
		}
		return -1
	}, name)
	slug = strings.Trim(slug, "-")
	if len(slug) > 28 {
		slug = strings.Trim(slug[:28], "-")
	}
	if slug == "" {
		slug = "stream"
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(sourceURL)))
	return fmt.Sprintf("stream-%s-%s", slug, hex.EncodeToString(sum[:4]))
}

// SubmitStream records a link for inspection. It is deliberately not qualified
// and carries no playback id, so the scheduler opens nothing on it until an
// inspection has watched it and said what it can count.
func (s *Postgres) SubmitStream(ctx context.Context, sub domain.StreamSubmission, by string) (domain.StreamSource, error) {
	id := StreamID(sub.Name, sub.SourceURL)

	claim, err := json.Marshal(sub.Claim)
	if err != nil {
		return domain.StreamSource{}, err
	}

	var out domain.StreamSource
	err = s.pool.QueryRow(ctx, `
		INSERT INTO streams (id, name, category, status, region, timezone,
		                     source_url, submitted_by, submitted_at, default_claim)
		VALUES ($1, $2, $3, 'Candidate', $4, $5, $6, nullif($7, ''), NOW(), $8::jsonb)
		ON CONFLICT (id) DO UPDATE SET
			name = excluded.name,
			region = excluded.region,
			timezone = excluded.timezone,
			category = excluded.category,
			default_claim = excluded.default_claim,
			updated_at = NOW(),
			-- Resubmitting clears the last verdict so the inspector looks again.
			-- A camera that was re-aimed or came back up deserves another pass,
			-- and without this it keeps whatever suspended it forever.
			qualification = '{}'::jsonb
		RETURNING id, coalesce(source_url, ''), status, coalesce(default_claim, '{}'::jsonb)`,
		id, sub.Name, sub.Category, sub.Region, sub.Timezone, sub.SourceURL, by, claim,
	).Scan(&out.ID, &out.SourceURL, &out.Status, &out.Claim)
	if err != nil {
		return domain.StreamSource{}, fmt.Errorf("submit stream: %w", err)
	}
	return out, nil
}

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
