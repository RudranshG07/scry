package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

// Drop below this for the window and the market invalidates, refunding everyone.
const minUptime = 99.0

func (s *Postgres) GetProof(ctx context.Context, id string) (domain.ProofOfObservation, error) {
	var p domain.ProofOfObservation
	var starts, ends time.Time
	var challenge *time.Time

	err := s.pool.QueryRow(ctx, `
		SELECT id, stream_id, status, rule_hash, evidence_root,
		       observation_starts_at, observation_ends_at, challenge_ends_at,
		       observed_value, winning_outcome_id
		FROM markets WHERE id = $1`, id).
		Scan(&p.MarketID, &p.StreamID, &p.Status, &p.RuleHash, &p.EvidenceRoot,
			&starts, &ends, &challenge, &p.ObservedValue, &p.WinningOutcomeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ProofOfObservation{}, ErrNotFound
	}
	if err != nil {
		return domain.ProofOfObservation{}, fmt.Errorf("query proof: %w", err)
	}

	p.ObservationWindow = domain.ObservationWindow{OpensAt: stamp(starts), ClosesAt: stamp(ends)}
	p.ChallengeEndsAt = stampOrNil(challenge)
	p.MinimumUptime = minUptime

	obs, uptime, err := s.observers(ctx, id)
	if err != nil {
		return domain.ProofOfObservation{}, err
	}
	p.Observers, p.MeasuredUptime = obs, uptime
	return p, nil
}

func (s *Postgres) observers(ctx context.Context, id string) ([]domain.Observer, float64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT observer_id, role, model_version, uptime, signature, invalid_reasons
		FROM observer_reports
		WHERE market_id = $1
		ORDER BY role`, id)
	if err != nil {
		return nil, 0, fmt.Errorf("query observers: %w", err)
	}
	defer rows.Close()

	out := []domain.Observer{}
	var total float64
	for rows.Next() {
		var o domain.Observer
		var uptime float64
		var bad []string
		if err := rows.Scan(&o.ID, &o.Role, &o.ModelVersion, &uptime, &o.Signature, &bad); err != nil {
			return nil, 0, fmt.Errorf("scan observers: %w", err)
		}
		o.Name = o.ID
		o.State = observerState(bad, o.Signature)
		total += uptime
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if len(out) == 0 {
		return out, 0, nil
	}
	return out, round(total/float64(len(out))*100, 2), nil
}

// A report with invalid reasons means this observer broke from the consensus;
// a signature means it committed to the result.
func observerState(bad []string, sig *string) string {
	switch {
	case len(bad) > 0:
		return "Disagreed"
	case sig != nil:
		return "Signed"
	default:
		return "Healthy"
	}
}
