package onchain

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/chain"
)

const (
	maxSpan       = 2000
	indexInterval = 10 * time.Second
)

var (
	depositedTopic = chain.EventTopic("PositionDeposited(bytes32,address,bytes32,uint256)")
	claimedTopic   = chain.EventTopic("Claimed(bytes32,address,uint256)")
	refundedTopic  = chain.EventTopic("Refunded(bytes32,address,uint256)")
)

// Blocks the index stays behind the head, so a position it records is not then
// taken back by a reorg. Polygon has reorganised more deeply than Base's single
// sequencer ever has.
var confirmations = map[int64]uint64{137: 16, 80002: 16}

const defaultConfirmations = 5

func (w *Worker) indexing(ctx context.Context) {
	for {
		if err := w.index(ctx); err != nil && ctx.Err() == nil {
			w.log.Error("index pass failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(indexInterval):
		}
	}
}

func (w *Worker) index(ctx context.Context) error {
	consumer := fmt.Sprintf("positions:%d", w.id)
	var done int64
	err := w.pool.QueryRow(ctx, `
		SELECT block_number::bigint FROM indexer_checkpoints WHERE consumer_id = $1`, consumer).Scan(&done)
	if errors.Is(err, pgx.ErrNoRows) {
		var first *int64
		if err := w.pool.QueryRow(ctx, `
			SELECT min(created_block) FROM market_deployments WHERE chain_id = $1`, w.id).Scan(&first); err != nil {
			return fmt.Errorf("find the first deployment: %w", err)
		}
		if first == nil {
			return nil
		}
		done = *first - 1
	} else if err != nil {
		return fmt.Errorf("read checkpoint: %w", err)
	}

	head, err := w.client.BlockNumber(ctx)
	if err != nil {
		return err
	}
	depth := confirmations[w.id]
	if depth == 0 {
		depth = defaultConfirmations
	}
	if head <= depth || head-depth <= uint64(done) {
		return nil
	}
	from := uint64(done) + 1
	to := min(head-depth, from+w.span-1)

	// Every market is in the one book, so this is one query over one address
	// however many markets are running.
	markets, err := w.markets(ctx)
	if err != nil {
		return err
	}
	logs, err := w.client.Logs(ctx, from, to, []string{w.book},
		[]string{depositedTopic, claimedTopic, refundedTopic})
	if err != nil {
		// Public endpoints cap how many blocks one query may cover and say so
		// each in their own words. Asking for fewer answers all of them.
		w.span = max(1, w.span/2)
		return fmt.Errorf("logs %d to %d: %w", from, to, err)
	}
	sort.Slice(logs, func(i, j int) bool {
		if logs[i].BlockNumber != logs[j].BlockNumber {
			return logs[i].BlockNumber < logs[j].BlockNumber
		}
		return logs[i].LogIndex < logs[j].LogIndex
	})
	for _, entry := range logs {
		if entry.Removed {
			continue
		}
		if len(entry.Topics) < 2 {
			continue
		}
		if err := w.record(ctx, markets[strings.ToLower(entry.Topics[1])], entry); err != nil {
			return err
		}
	}

	_, err = w.pool.Exec(ctx, `
		INSERT INTO indexer_checkpoints (consumer_id, chain_id, block_number, transaction_index, log_index, block_hash, updated_at)
		VALUES ($1, $2, $3, 0, 0, '', NOW())
		ON CONFLICT (consumer_id) DO UPDATE SET block_number = EXCLUDED.block_number, updated_at = NOW()`,
		consumer, w.id, int64(to))
	if err != nil {
		return fmt.Errorf("save checkpoint: %w", err)
	}
	w.span = min(maxSpan, w.span*2)
	return nil
}

// The markets that can still emit anything worth recording, by the id the book
// knows them under: deposits until they lock, then claims and refunds for as
// long as anyone is likely to make one.
func (w *Worker) markets(ctx context.Context) (map[string]string, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT d.market_id
		FROM market_deployments d
		JOIN markets m ON m.id = d.market_id
		WHERE d.chain_id = $1
		  AND d.state IN ('Created', 'Proposed', 'Finalized', 'Voided')
		  AND m.observation_ends_at > NOW() - INTERVAL '30 days'`, w.id)
	if err != nil {
		return nil, fmt.Errorf("list markets: %w", err)
	}
	defer rows.Close()

	out := map[string]string{}
	for rows.Next() {
		var market string
		if err := rows.Scan(&market); err != nil {
			return nil, err
		}
		key := chain.MarketKey(market)
		out["0x"+hex.EncodeToString(key[:])] = market
	}
	return out, rows.Err()
}

func (w *Worker) record(ctx context.Context, market string, entry chain.Log) error {
	if market == "" || len(entry.Topics) < 3 || len(entry.Data) < 32 {
		return nil
	}
	subject, err := chain.Bytes32(entry.Topics[2])
	if err != nil {
		return fmt.Errorf("log account: %w", err)
	}
	account, err := chain.AddressFromWord(subject[:])
	if err != nil {
		return err
	}
	payload := map[string]string{
		"account": strings.ToLower(account),
		"amount":  new(big.Int).SetBytes(entry.Data[:32]).String(),
	}

	var kind string
	switch entry.Topics[0] {
	case depositedTopic:
		if len(entry.Topics) < 4 {
			return nil
		}
		outcome, err := chain.Bytes32(entry.Topics[3])
		if err != nil {
			return fmt.Errorf("log outcome: %w", err)
		}
		payload["outcomeId"] = chain.TextOf(outcome)
		kind = "position.placed"
	case claimedTopic:
		kind = "payout.claimed"
	case refundedTopic:
		kind = "refund.claimed"
	default:
		return nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Recorded once however many times a range is read again, and projected
	// only the first time, so a pass that failed halfway can simply be repeated.
	tag, err := tx.Exec(ctx, `
		INSERT INTO chain_events (event_id, chain_id, block_number, transaction_index, log_index,
		                          block_hash, transaction_hash, event_type, market_id, payload, recorded_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
		ON CONFLICT DO NOTHING`,
		fmt.Sprintf("%d:%s:%d", w.id, strings.ToLower(entry.TransactionHash), entry.LogIndex),
		w.id, int64(entry.BlockNumber), int32(entry.TransactionIndex), int32(entry.LogIndex),
		entry.BlockHash, strings.ToLower(entry.TransactionHash), kind, market, encoded)
	if err != nil {
		return fmt.Errorf("record %s: %w", kind, err)
	}
	if tag.RowsAffected() == 0 {
		return tx.Commit(ctx)
	}

	switch kind {
	case "position.placed":
		_, err = tx.Exec(ctx, `
			INSERT INTO projected_positions (market_id, chain_id, account, outcome_id, amount, updated_at)
			VALUES ($1, $2, $3, $4, $5::numeric, NOW())
			ON CONFLICT (market_id, chain_id, account, outcome_id)
			DO UPDATE SET amount = projected_positions.amount + EXCLUDED.amount, updated_at = NOW()`,
			market, w.id, payload["account"], payload["outcomeId"], payload["amount"])
	case "payout.claimed":
		_, err = tx.Exec(ctx, `
			UPDATE projected_positions p
			SET claimed_amount = $4::numeric, updated_at = NOW()
			FROM markets m
			WHERE p.market_id = $1 AND p.chain_id = $2 AND p.account = $3
			  AND m.id = p.market_id AND p.outcome_id = m.winning_outcome_id`,
			market, w.id, payload["account"], payload["amount"])
	case "refund.claimed":
		_, err = tx.Exec(ctx, `
			UPDATE projected_positions
			SET refunded_amount = amount, updated_at = NOW()
			WHERE market_id = $1 AND chain_id = $2 AND account = $3`,
			market, w.id, payload["account"])
	}
	if err != nil {
		return fmt.Errorf("project %s: %w", kind, err)
	}
	w.log.Info("chain event recorded", "market", market, "kind", kind, "account", payload["account"],
		"amount", payload["amount"])
	return tx.Commit(ctx)
}
