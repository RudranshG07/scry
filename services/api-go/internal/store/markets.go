package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

const marketQuery = `
	SELECT m.id, m.stream_id, s.category, s.name, s.region, m.question, m.status,
	       m.chain_id, m.contract_address,
	       m.opens_at, m.locks_at, m.observation_starts_at, m.observation_ends_at, m.challenge_ends_at,
	       m.observed_value, m.winning_outcome_id,
	       COALESCE((SELECT SUM(p.amount) FROM projected_positions p
	                 WHERE p.market_id = m.id), 0)::float8,
	       COALESCE((SELECT h.probability FROM market_probability_history h
	                 WHERE h.market_id = m.id AND h.source = 'scry_ai'
	                 ORDER BY h.recorded_at DESC LIMIT 1), 0)::float8,
	       COALESCE((SELECT SUM(c.event_count)::float8 * 60 / NULLIF(SUM(c.interval_seconds), 0)
	                 FROM count_observations c
	                 WHERE c.stream_id = m.stream_id
	                   AND c.observed_at > NOW() - INTERVAL '5 minutes'), 0)::float8,
	       COALESCE((SELECT SUM(c.event_count)::float8 * 60 / NULLIF(SUM(c.interval_seconds), 0)
	                 FROM count_observations c
	                 WHERE c.stream_id = m.stream_id
	                   AND c.observed_at > NOW() - INTERVAL '7 days'), 0)::float8
	FROM markets m
	JOIN streams s ON s.id = m.stream_id`

func readMarket(row pgx.CollectableRow) (domain.Market, error) {
	var m domain.Market
	var opens, locks, starts, ends time.Time
	var challenge *time.Time
	var ai float64

	err := row.Scan(
		&m.ID, &m.StreamID, &m.Category, &m.Location, &m.City, &m.Question, &m.Status,
		&m.ChainID, &m.ContractAddress,
		&opens, &locks, &starts, &ends, &challenge,
		&m.ObservedValue, &m.WinningOutcomeID, &m.Pool, &ai,
		&m.CurrentRate, &m.Baseline,
	)
	if err != nil {
		return domain.Market{}, err
	}

	m.OpensAt = stamp(opens)
	m.LocksAt = stamp(locks)
	m.ObservationStartsAt = stamp(starts)
	m.ObservationEndsAt = stamp(ends)
	m.ResolvedAt = stampOrNil(challenge)
	m.Forecast = round(ai*100, 0)
	m.Unit = domain.UnitFor(m.Category)
	m.CurrentRate = round(m.CurrentRate, 1)
	m.Baseline = round(m.Baseline, 1)
	return m, nil
}

const (
	// How far back settled markets stay on the board. Long enough to see what
	// just happened, short enough that the list is about now.
	recentWindow = "6 hours"
	// A hard ceiling so one long-running stream cannot bury the rest.
	listLimit = 60
)

// ListMarkets returns what is live plus what settled recently.
//
// It used to select every market ever opened. After a day of running that was
// 310 rows, 292 of them invalidated, and the three live markets were buried
// under weeks of dead ones. The board is meant to answer "what can I watch and
// take a side on now", and an unbounded history answers a different question
// while getting slower every hour.
func (s *Postgres) ListMarkets(ctx context.Context) ([]domain.Market, error) {
	rows, err := s.pool.Query(ctx, marketQuery+`
		WHERE m.status IN ('Scheduled', 'Open', 'Locked', 'Observing', 'Result proposed')
		   OR m.observation_ends_at > NOW() - INTERVAL '`+recentWindow+`'
		ORDER BY m.opens_at DESC
		LIMIT `+strconv.Itoa(listLimit))
	if err != nil {
		return nil, fmt.Errorf("query markets: %w", err)
	}
	all, err := pgx.CollectRows(rows, readMarket)
	if err != nil {
		return nil, fmt.Errorf("scan markets: %w", err)
	}
	return s.fill(ctx, all)
}

func (s *Postgres) GetMarket(ctx context.Context, id string) (domain.Market, error) {
	rows, err := s.pool.Query(ctx, marketQuery+` WHERE m.id = $1`, id)
	if err != nil {
		return domain.Market{}, fmt.Errorf("query market: %w", err)
	}
	m, err := pgx.CollectExactlyOneRow(rows, readMarket)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Market{}, ErrNotFound
	}
	if err != nil {
		return domain.Market{}, fmt.Errorf("scan market: %w", err)
	}

	one, err := s.fill(ctx, []domain.Market{m})
	if err != nil {
		return domain.Market{}, err
	}
	return one[0], nil
}

// fill adds everything that needs its own query.
func (s *Postgres) fill(ctx context.Context, ms []domain.Market) ([]domain.Market, error) {
	if len(ms) == 0 {
		return ms, nil
	}

	ids := make([]string, len(ms))
	for i, m := range ms {
		ids[i] = m.ID
	}

	outs, err := s.outcomes(ctx, ids)
	if err != nil {
		return nil, err
	}
	trends, err := s.trends(ctx, ids)
	if err != nil {
		return nil, err
	}
	seen, err := s.observerCount(ctx, ids)
	if err != nil {
		return nil, err
	}

	for i := range ms {
		m := &ms[i]
		m.Outcomes = balance(outs[m.ID])
		m.Trend = filled(trends[m.ID])
		m.Observers = seen[m.ID]
	}
	return ms, nil
}

func (s *Postgres) outcomes(ctx context.Context, ids []string) (map[string][]domain.MarketOutcome, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT o.market_id, o.outcome_id, o.label,
		       COALESCE((SELECT SUM(p.amount) FROM projected_positions p
		                 WHERE p.market_id = o.market_id AND p.outcome_id = o.outcome_id), 0)::float8,
		       COALESCE((SELECT SUM(p.amount) FROM projected_positions p
		                 WHERE p.market_id = o.market_id), 0)::float8
		FROM market_outcomes o
		WHERE o.market_id = ANY($1)
		ORDER BY o.market_id, o.sort_order`, ids)
	if err != nil {
		return nil, fmt.Errorf("query outcomes: %w", err)
	}
	defer rows.Close()

	out := map[string][]domain.MarketOutcome{}
	for rows.Next() {
		var id string
		var o domain.MarketOutcome
		var staked, total float64
		if err := rows.Scan(&id, &o.ID, &o.Label, &staked, &total); err != nil {
			return nil, fmt.Errorf("scan outcomes: %w", err)
		}
		o.Probability, o.ReturnRate = price(staked, total)
		out[id] = append(out[id], o)
	}
	return out, rows.Err()
}

// price is parimutuel: your share of the pool is the odds, and the payout is
// its inverse. No stake either side means an even market.
func price(staked, total float64) (float64, float64) {
	share := 0.5
	if total > 0 {
		share = staked / total
	}
	if share <= 0 {
		return 0, 0
	}
	return round(share*100, 0), round(1/share, 2)
}

func balance(os []domain.MarketOutcome) []domain.MarketOutcome {
	if len(os) < 2 {
		return filled(os)
	}
	var used float64
	for _, o := range os[:len(os)-1] {
		used += o.Probability
	}
	os[len(os)-1].Probability = 100 - used
	return os
} 

func (s *Postgres) trends(ctx context.Context, ids []string) (map[string][]float64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT market_id, probability
		FROM market_probability_history
		WHERE market_id = ANY($1) AND source = 'market'
		ORDER BY market_id, recorded_at`, ids)
	if err != nil {
		return nil, fmt.Errorf("query trend: %w", err)
	}
	defer rows.Close()

	out := map[string][]float64{}
	for rows.Next() {
		var id string
		var p float64
		if err := rows.Scan(&id, &p); err != nil {
			return nil, fmt.Errorf("scan trend: %w", err)
		}
		out[id] = append(out[id], round(p*100, 0))
	}
	return out, rows.Err()
}

func (s *Postgres) observerCount(ctx context.Context, ids []string) (map[string]int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT market_id, COUNT(*)
		FROM observer_reports
		WHERE market_id = ANY($1)
		GROUP BY market_id`, ids)
	if err != nil {
		return nil, fmt.Errorf("query observers: %w", err)
	}
	defer rows.Close()

	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, fmt.Errorf("scan observers: %w", err)
		}
		out[id] = n
	}
	return out, rows.Err()
}
