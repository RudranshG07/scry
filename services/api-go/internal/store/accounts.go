package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

func (s *Postgres) GetPortfolio(ctx context.Context, account string) (domain.Portfolio, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.market_id, p.outcome_id, m.question, o.label, m.status, m.winning_outcome_id,
		       p.amount::float8, p.claimed_amount::float8, p.refunded_amount::float8, p.updated_at,
		       COALESCE((SELECT SUM(t.amount) FROM projected_positions t
		                 WHERE t.market_id = p.market_id), 0)::float8,
		       COALESCE((SELECT SUM(t.amount) FROM projected_positions t
		                 WHERE t.market_id = p.market_id AND t.outcome_id = p.outcome_id), 0)::float8
		FROM projected_positions p
		JOIN markets m ON m.id = p.market_id
		JOIN market_outcomes o ON o.market_id = p.market_id AND o.outcome_id = p.outcome_id
		WHERE p.account = $1
		ORDER BY p.updated_at DESC`, account)
	if err != nil {
		return domain.Portfolio{}, fmt.Errorf("query positions: %w", err)
	}

	held, err := pgx.CollectRows(rows, readPosition)
	if err != nil {
		return domain.Portfolio{}, fmt.Errorf("scan positions: %w", err)
	}

	pf := domain.Portfolio{Address: account, Positions: filled(held)}
	for _, p := range held {
		pf.TotalPositioned += p.Amount
		if p.State == "Claimable" || p.State == "Refundable" {
			pf.Claimable += p.Amount
		}
	}
	return pf, nil
}

func readPosition(row pgx.CollectableRow) (domain.Position, error) {
	var p domain.Position
	var outcome, status string
	var won *string
	var claimed, refunded, pool, side float64
	var at time.Time

	err := row.Scan(&p.MarketID, &outcome, &p.Question, &p.OutcomeLabel, &status, &won,
		&p.Amount, &claimed, &refunded, &at, &pool, &side)
	if err != nil {
		return domain.Position{}, err
	}

	p.ID = p.MarketID + ":" + outcome
	p.CreatedAt = stamp(at)
	p.State = positionState(status, outcome, won, claimed, refunded)
	if side > 0 {
		p.EstimatedReturn = round(p.Amount*(pool/side), 2)
	}
	return p, nil
}

// An invalid market refunds every side. A resolved one only pays the winner.
func positionState(status, outcome string, won *string, claimed, refunded float64) string {
	winner := won != nil && *won == outcome

	switch {
	case status == "Invalid" && refunded > 0:
		return "Refunded"
	case status == "Invalid":
		return "Refundable"
	case status == "Resolved" && winner && claimed > 0:
		return "Claimed"
	case status == "Resolved" && winner:
		return "Claimable"
	default:
		return "Open"
	}
}

func (s *Postgres) GetLeaderboard(ctx context.Context) ([]domain.LeaderboardEntry, error) {
	// DISTINCT ON forces its own ORDER BY, so rank has to be applied outside.
	rows, err := s.pool.Query(ctx, `
		SELECT forecaster_id, forecaster_kind, category, rank, sample_count,
		       brier_score, calibration_error
		FROM (
			SELECT DISTINCT ON (forecaster_id)
			       forecaster_id, forecaster_kind, category, rank, sample_count,
			       brier_score, calibration_error
			FROM forecaster_reputation_snapshots
			WHERE eligible
			ORDER BY forecaster_id, snapshot_at DESC
		) latest
		ORDER BY rank`)
	if err != nil {
		return nil, fmt.Errorf("query leaderboard: %w", err)
	}
	defer rows.Close()

	out := []domain.LeaderboardEntry{}
	for rows.Next() {
		var e domain.LeaderboardEntry
		var off float64
		if err := rows.Scan(&e.ID, &e.Kind, &e.Specialty, &e.Rank, &e.Forecasts,
			&e.BrierScore, &off); err != nil {
			return nil, fmt.Errorf("scan leaderboard: %w", err)
		}
		e.DisplayName = e.ID
		e.Calibration = round((1-off)*100, 0)
		out = append(out, e)
	}
	return out, rows.Err()
}
