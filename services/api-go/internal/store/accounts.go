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
		SELECT p.market_id, p.chain_id, p.outcome_id, m.question, o.label,
		       d.state, d.contract_address, m.winning_outcome_id,
		       p.amount::float8 / 1e6, p.claimed_amount::float8, p.refunded_amount::float8, p.updated_at,
		       COALESCE((SELECT SUM(t.amount) FROM projected_positions t
		                 WHERE t.market_id = p.market_id AND t.chain_id = p.chain_id), 0)::float8,
		       COALESCE((SELECT SUM(t.amount) FROM projected_positions t
		                 WHERE t.market_id = p.market_id AND t.chain_id = p.chain_id
		                   AND t.outcome_id = p.outcome_id), 0)::float8
		FROM projected_positions p
		JOIN markets m ON m.id = p.market_id
		JOIN market_outcomes o ON o.market_id = p.market_id AND o.outcome_id = p.outcome_id
		LEFT JOIN market_deployments d ON d.market_id = p.market_id AND d.chain_id = p.chain_id
		WHERE p.account = lower($1)
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
			pf.Claimable += p.EstimatedReturn
		}
	}
	return pf, nil
}

func readPosition(row pgx.CollectableRow) (domain.Position, error) {
	var p domain.Position
	var outcome string
	var deployment, won *string
	var claimed, refunded, pool, side float64
	var at time.Time

	err := row.Scan(&p.MarketID, &p.ChainID, &outcome, &p.Question, &p.OutcomeLabel,
		&deployment, &p.ContractAddress, &won,
		&p.Amount, &claimed, &refunded, &at, &pool, &side)
	if err != nil {
		return domain.Position{}, err
	}

	p.ID = fmt.Sprintf("%s:%d:%s", p.MarketID, p.ChainID, outcome)
	p.CreatedAt = stamp(at)
	p.State = positionState(deployment, outcome, won, claimed, refunded)
	switch {
	case p.State == "Refundable" || p.State == "Refunded":
		p.EstimatedReturn = p.Amount
	case side > 0:
		p.EstimatedReturn = round(p.Amount*(pool/side), 2)
	}
	return p, nil
}

// What a position can do comes from its contract, not from the engine's view of
// the market: the engine calls a market resolved before the chain has finished
// its own challenge window, and a claim sent then would revert.
func positionState(deployment *string, outcome string, won *string, claimed, refunded float64) string {
	state := ""
	if deployment != nil {
		state = *deployment
	}
	winner := won != nil && *won == outcome

	switch {
	case state == "Voided" && refunded > 0:
		return "Refunded"
	case state == "Voided":
		return "Refundable"
	case state == "Finalized" && winner && claimed > 0:
		return "Claimed"
	case state == "Finalized" && winner:
		return "Claimable"
	default:
		return "Open"
	}
}

func (s *Postgres) GetLeaderboard(ctx context.Context) ([]domain.LeaderboardEntry, error) {
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
