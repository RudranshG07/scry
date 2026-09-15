package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

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
		RETURNING id, name, region, timezone, coalesce(source_url, ''), status,
		          coalesce(default_claim, '{}'::jsonb)`,
		id, sub.Name, sub.Category, sub.Region, sub.Timezone, sub.SourceURL, by, claim,
	).Scan(&out.ID, &out.Name, &out.Region, &out.Timezone, &out.SourceURL, &out.Status, &out.Claim)
	if err != nil {
		return domain.StreamSource{}, fmt.Errorf("submit stream: %w", err)
	}
	return out, nil
}

func (s *Postgres) Watchable(ctx context.Context) ([]domain.StreamSource, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, region, timezone, coalesce(source_url, ''), status,
		       coalesce(default_claim, '{}'::jsonb)
		FROM streams
		WHERE status = 'Qualified'
		  AND coalesce(btrim(source_url), '') <> ''
		  AND coalesce((qualification->>'provisional')::boolean, false) = false
		ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list watchable streams: %w", err)
	}
	defer rows.Close()

	out := []domain.StreamSource{}
	for rows.Next() {
		var stream domain.StreamSource
		if err := rows.Scan(&stream.ID, &stream.Name, &stream.Region, &stream.Timezone,
			&stream.SourceURL, &stream.Status, &stream.Claim); err != nil {
			return nil, err
		}
		out = append(out, stream)
	}
	return out, rows.Err()
}

func (s *Postgres) SceneForMarket(ctx context.Context, marketID string) (string, error) {
	var scene string
	err := s.pool.QueryRow(ctx, `
		SELECT coalesce(st.qualification->>'scene', '')
		FROM markets m JOIN streams st ON st.id = m.stream_id
		WHERE m.id = $1`, marketID).Scan(&scene)
	if err != nil {
		return "", fmt.Errorf("read qualified scene: %w", err)
	}
	return scene, nil
}

func (s *Postgres) PendingQualification(ctx context.Context, stale time.Duration) ([]domain.StreamSource, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, region, timezone, coalesce(source_url, ''), status,
		       coalesce(default_claim, '{}'::jsonb)
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
		if err := rows.Scan(&s.ID, &s.Name, &s.Region, &s.Timezone, &s.SourceURL,
			&s.Status, &s.Claim); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (s *Postgres) RecordQualification(ctx context.Context, id string, v domain.Qualification) error {
	status := "Suspended"
	if v.Usable {
		status = "Qualified"
	}

	now := time.Now().UTC().Format(time.RFC3339)
	fields := map[string]any{
		"inspectedAt":  now,
		"checkedAt":    now,
		"usable":       v.Usable,
		"reason":       v.Reason,
		"counts":       v.Counts,
		"subjects":     v.Subjects,
		"peak":         v.Peak,
		"disagreement": v.Disagreement,
		"provisional":  v.Provisional,
	}
	if v.Threshold > 0 {
		fields["threshold"] = v.Threshold
	}
	if v.Scene != "" {
		fields["scene"] = v.Scene
	}

	note, err := json.Marshal(fields)
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

func (s *Postgres) StreamStatus(ctx context.Context, id string) (domain.StreamStatus, error) {
	var out domain.StreamStatus
	var threshold *int
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, status, coalesce(source_url, ''), coalesce(default_claim, '{}'::jsonb),
		       coalesce(qualification->>'reason', ''), (qualification->>'threshold')::int,
		       qualification->>'inspectedAt'
		FROM streams
		WHERE id = $1`, id).
		Scan(&out.ID, &out.Name, &out.Status, &out.SourceURL, &out.Claim, &out.Reason, &threshold, &out.InspectedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, fmt.Errorf("read stream: %w", err)
	}
	if threshold != nil {
		out.Threshold = *threshold
	}
	return out, nil
}

func (s *Postgres) SubmittedSince(ctx context.Context, account string, since time.Duration) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM streams
		WHERE lower(submitted_by) = lower($1) AND submitted_at > NOW() - $2::interval`,
		account, since.String()).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count submissions: %w", err)
	}
	return count, nil
}
