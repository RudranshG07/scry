package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

var ErrClosed = errors.New("market is not taking positions")

// Long enough before the lock for the contract to be mined and a deposit to
// follow it. Asked for any later, the market would lock before anyone could use
// what was paid for.
const deployBeforeLock = time.Minute

func (s *Postgres) RequestDeployment(ctx context.Context, market string, chainID int64, account string) (domain.Deployment, error) {
	var out domain.Deployment
	err := s.pool.QueryRow(ctx, `
		SELECT chain_id, contract_address, state FROM market_deployments
		WHERE market_id = $1 AND chain_id = $2`, market, chainID).
		Scan(&out.ChainID, &out.ContractAddress, &out.State)
	if err == nil {
		return out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return out, fmt.Errorf("read deployment: %w", err)
	}

	var requester *string
	if account != "" {
		requester = &account
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO market_deployments (market_id, chain_id, state, requested_by)
		SELECT id, $2, 'Requested', $3 FROM markets
		WHERE id = $1 AND status IN ('Scheduled', 'Open') AND locks_at > NOW() + $4::interval
		ON CONFLICT (market_id, chain_id) DO UPDATE SET market_id = EXCLUDED.market_id
		RETURNING chain_id, contract_address, state`,
		market, chainID, requester, deployBeforeLock.String()).
		Scan(&out.ChainID, &out.ContractAddress, &out.State)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM markets WHERE id = $1)`, market).Scan(&exists); err != nil {
			return out, fmt.Errorf("find market: %w", err)
		}
		if !exists {
			return out, ErrNotFound
		}
		return out, ErrClosed
	}
	if err != nil {
		return out, fmt.Errorf("request deployment: %w", err)
	}
	return out, nil
}

func (s *Postgres) deployments(ctx context.Context, ids []string) (map[string][]domain.Deployment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT market_id, chain_id, contract_address, state
		FROM market_deployments
		WHERE market_id = ANY($1)
		ORDER BY market_id, chain_id`, ids)
	if err != nil {
		return nil, fmt.Errorf("query deployments: %w", err)
	}
	defer rows.Close()

	out := map[string][]domain.Deployment{}
	for rows.Next() {
		var id string
		var d domain.Deployment
		if err := rows.Scan(&id, &d.ChainID, &d.ContractAddress, &d.State); err != nil {
			return nil, fmt.Errorf("scan deployments: %w", err)
		}
		out[id] = append(out[id], d)
	}
	return out, rows.Err()
}

// A deployment is ready to be signed for once the engine has a result and the
// contract exists to carry it. Anything further along has already been signed.
const settlementQuery = `
	SELECT d.market_id, d.chain_id, d.contract_address, m.observed_value, m.winning_outcome_id,
	       COALESCE(m.evidence_root, ''), m.rule_hash, m.observation_ends_at
	FROM market_deployments d
	JOIN markets m ON m.id = d.market_id
	WHERE d.state = 'Created'
	  AND m.status IN ('Result proposed', 'Resolved')
	  AND m.observed_value IS NOT NULL
	  AND m.winning_outcome_id IS NOT NULL`

func readSettlement(row pgx.CollectableRow) (domain.Settlement, error) {
	var out domain.Settlement
	var ends time.Time
	err := row.Scan(&out.MarketID, &out.ChainID, &out.ContractAddress, &out.ObservedValue,
		&out.WinningOutcomeID, &out.EvidenceRoot, &out.RuleHash, &ends)
	out.ObservedAt = ends.Unix()
	return out, err
}

// PendingSettlements lists what one observer has yet to sign: results on
// markets it reported cleanly on, since those are the only counts it can check
// a result against.
func (s *Postgres) PendingSettlements(ctx context.Context, observer string) ([]domain.Settlement, error) {
	rows, err := s.pool.Query(ctx, settlementQuery+`
		  AND EXISTS (SELECT 1 FROM observer_reports r
		              WHERE r.market_id = d.market_id AND r.observer_id = $1
		                AND cardinality(r.invalid_reasons) = 0)
		  AND NOT EXISTS (SELECT 1 FROM result_attestations a
		                  WHERE a.market_id = d.market_id AND a.chain_id = d.chain_id
		                    AND a.observer_id = $1)
		ORDER BY m.observation_ends_at
		LIMIT 50`, observer)
	if err != nil {
		return nil, fmt.Errorf("query settlements: %w", err)
	}
	pending, err := pgx.CollectRows(rows, readSettlement)
	if err != nil {
		return nil, fmt.Errorf("scan settlements: %w", err)
	}
	return s.withBands(ctx, pending)
}

func (s *Postgres) SettlementFor(ctx context.Context, market string, chainID int64) (domain.Settlement, error) {
	rows, err := s.pool.Query(ctx, settlementQuery+` AND d.market_id = $1 AND d.chain_id = $2`, market, chainID)
	if err != nil {
		return domain.Settlement{}, fmt.Errorf("query settlement: %w", err)
	}
	one, err := pgx.CollectExactlyOneRow(rows, readSettlement)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Settlement{}, ErrNotFound
	}
	if err != nil {
		return domain.Settlement{}, fmt.Errorf("scan settlement: %w", err)
	}
	filled, err := s.withBands(ctx, []domain.Settlement{one})
	if err != nil {
		return domain.Settlement{}, err
	}
	return filled[0], nil
}

func (s *Postgres) withBands(ctx context.Context, settlements []domain.Settlement) ([]domain.Settlement, error) {
	if len(settlements) == 0 {
		return []domain.Settlement{}, nil
	}
	ids := make([]string, len(settlements))
	for i, settlement := range settlements {
		ids[i] = settlement.MarketID
	}
	rows, err := s.pool.Query(ctx, `
		SELECT market_id, outcome_id, minimum_value, maximum_value
		FROM market_outcomes
		WHERE market_id = ANY($1)
		ORDER BY market_id, sort_order`, ids)
	if err != nil {
		return nil, fmt.Errorf("query bands: %w", err)
	}
	defer rows.Close()

	bands := map[string][]domain.OutcomeBand{}
	for rows.Next() {
		var id string
		var band domain.OutcomeBand
		if err := rows.Scan(&id, &band.ID, &band.Minimum, &band.Maximum); err != nil {
			return nil, fmt.Errorf("scan bands: %w", err)
		}
		bands[id] = append(bands[id], band)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range settlements {
		settlements[i].Outcomes = filled(bands[settlements[i].MarketID])
	}
	return settlements, nil
}

func (s *Postgres) SaveAttestation(ctx context.Context, settlement domain.Settlement, observer, signer, signature string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO result_attestations (market_id, chain_id, observer_id, signer, digest, signature)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (market_id, chain_id, observer_id)
		DO UPDATE SET signer = EXCLUDED.signer, digest = EXCLUDED.digest,
		              signature = EXCLUDED.signature, signed_at = NOW()`,
		settlement.MarketID, settlement.ChainID, observer, signer, settlement.Digest, signature)
	if err != nil {
		return fmt.Errorf("save attestation: %w", err)
	}
	return nil
}
