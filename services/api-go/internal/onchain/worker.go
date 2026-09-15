// Package onchain carries markets from the database to the chains they take
// positions on: it deploys a market when somebody wants to trade it, proposes
// the result its observers signed, finalizes it after the challenge window, and
// voids whatever cannot settle so every stake comes back.
package onchain

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/RudranshG07/scry/services/api-go/internal/chain"
	"github.com/RudranshG07/scry/services/api-go/internal/config"
)

const (
	pollInterval = 3 * time.Second
	txTimeout    = 2 * time.Minute

	// Too close to the lock to be worth deploying: the contract would be mined
	// after the last moment anyone could deposit into it.
	lockMargin = 20 * time.Second

	// A result the observers have not both signed by then is voided, and so is
	// a market the engine never resolved at all.
	unattested = 20 * time.Minute
	unresolved = 2 * time.Hour

	fallbackChallenge = 10 * time.Minute

	minimumUptimeBps  = 9500
	maximumDriftMs    = 2000
	maximumDivergence = 20
)

// ScryTypes.MarketStatus and ObservationStatus, by position.
const (
	marketResolved = 6
	marketInvalid  = 7

	observationProposed   = 0
	observationChallenged = 1
	observationFinal      = 2
	observationInvalid    = 3
)

// A row that failed waits five seconds per failure, up to five minutes, so one
// market a node keeps refusing does not hold up the rest of the chain.
const due = `d.updated_at <= NOW() - LEAST(d.attempts, 60) * INTERVAL '5 seconds'`

type Worker struct {
	pool      *pgxpool.Pool
	client    *chain.Client
	signer    *chain.Signer
	log       *slog.Logger
	id        int64
	factory   string
	resolver  string
	threshold int
	span      uint64
}

func New(pool *pgxpool.Pool, log *slog.Logger, signer *chain.Signer, deployment config.Chain) *Worker {
	return &Worker{
		pool:     pool,
		client:   chain.New(deployment.RPC),
		signer:   signer,
		log:      log.With("chain", deployment.ID),
		id:       deployment.ID,
		factory:  deployment.Factory,
		resolver: deployment.Resolver,
		span:     maxSpan,
	}
}

// Check refuses a node on the wrong chain, or contracts that do not name this
// server as their operator. Every transaction after that would revert, and the
// markets they were meant to settle would sit until someone abandoned them.
func (w *Worker) Check(ctx context.Context) error {
	id, err := w.client.ChainID(ctx)
	if err != nil {
		return err
	}
	if id.Int64() != w.id {
		return fmt.Errorf("SCRY_RPC_%d reaches chain %s", w.id, id)
	}
	for _, contract := range []string{w.factory, w.resolver} {
		operator, err := w.addressAt(ctx, contract, chain.OperatorCall())
		if err != nil {
			return fmt.Errorf("read the operator of %s: %w", contract, err)
		}
		if !strings.EqualFold(operator, w.signer.Address) {
			return fmt.Errorf("%s names %s as its operator, not %s", contract, operator, w.signer.Address)
		}
	}
	registry, err := w.addressAt(ctx, w.resolver, chain.ObserverRegistryCall())
	if err != nil {
		return fmt.Errorf("read the observer registry: %w", err)
	}
	threshold, err := w.number(ctx, registry, chain.SignatureThresholdCall())
	if err != nil {
		return fmt.Errorf("read the signature threshold: %w", err)
	}
	w.threshold = max(1, int(threshold.Int64()))
	return nil
}

func (w *Worker) Run(ctx context.Context) {
	go w.indexing(ctx)
	for {
		for _, job := range []struct {
			name string
			run  func(context.Context) error
		}{
			{"deploy", w.deploy},
			{"propose", w.propose},
			{"finalize", w.finalize},
			{"void", w.void},
		} {
			if err := job.run(ctx); err != nil && ctx.Err() == nil {
				w.log.Error("chain job failed", "job", job.name, "error", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(pollInterval):
		}
	}
}

func (w *Worker) deploy(ctx context.Context) error {
	var id, stream, rule string
	var opens, locks, starts, ends time.Time
	err := w.pool.QueryRow(ctx, `
		SELECT m.id, m.stream_id, m.rule_hash, m.opens_at, m.locks_at,
		       m.observation_starts_at, m.observation_ends_at
		FROM market_deployments d
		JOIN markets m ON m.id = d.market_id
		WHERE d.chain_id = $1 AND d.state = 'Requested' AND `+due+`
		ORDER BY m.locks_at
		LIMIT 1`, w.id).Scan(&id, &stream, &rule, &opens, &locks, &starts, &ends)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find requested deployments: %w", err)
	}

	key := chain.MarketKey(id)
	existing, err := w.marketFor(ctx, key)
	if err != nil {
		return w.retry(ctx, id, err)
	}
	if existing != "" {
		return w.created(ctx, id, existing, "", 0)
	}
	if time.Until(locks) < lockMargin {
		return w.settled(ctx, id, "Failed", "", "the market locked before it was deployed")
	}

	ruleHash, err := chain.Bytes32(rule)
	if err != nil {
		return w.retry(ctx, id, fmt.Errorf("rule hash: %w", err))
	}
	outcomes, err := w.outcomes(ctx, id)
	if err != nil {
		return w.retry(ctx, id, err)
	}
	data := chain.CreateMarketCall(chain.Rule{
		MarketID:            key,
		StreamID:            chain.MarketKey(stream),
		RuleHash:            ruleHash,
		OpensAt:             uint64(opens.Unix()),
		LocksAt:             uint64(locks.Unix()),
		ObservationStartsAt: uint64(starts.Unix()),
		ObservationEndsAt:   uint64(ends.Unix()),
		MinimumUptimeBps:    minimumUptimeBps,
		MaximumDriftMs:      maximumDriftMs,
		MaximumDivergence:   maximumDivergence,
	}, outcomes, nil)

	hash, block, err := w.send(ctx, w.factory, data)
	if err != nil {
		return w.retry(ctx, id, err)
	}
	address, err := w.marketFor(ctx, key)
	if err != nil || address == "" {
		return w.retry(ctx, id, fmt.Errorf("created in %s but the factory does not list it yet: %v", hash, err))
	}
	return w.created(ctx, id, address, hash, block)
}

func (w *Worker) outcomes(ctx context.Context, market string) ([]chain.Outcome, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT outcome_id, label, minimum_value, maximum_value
		FROM market_outcomes
		WHERE market_id = $1
		ORDER BY sort_order`, market)
	if err != nil {
		return nil, fmt.Errorf("read outcomes: %w", err)
	}
	defer rows.Close()

	var out []chain.Outcome
	for rows.Next() {
		var id, label string
		var minimum, maximum *int64
		if err := rows.Scan(&id, &label, &minimum, &maximum); err != nil {
			return nil, err
		}
		key, err := chain.Text32(id)
		if err != nil {
			return nil, err
		}
		outcome := chain.Outcome{ID: key, Label: label}
		if minimum != nil {
			if *minimum < 0 {
				return nil, fmt.Errorf("outcome %s has a negative bound", id)
			}
			outcome.Minimum, outcome.HasMinimum = big.NewInt(*minimum), true
		}
		if maximum != nil {
			if *maximum < 0 {
				return nil, fmt.Errorf("outcome %s has a negative bound", id)
			}
			outcome.Maximum, outcome.HasMaximum = big.NewInt(*maximum), true
		}
		out = append(out, outcome)
	}
	return out, rows.Err()
}

func (w *Worker) propose(ctx context.Context) error {
	var market, contract, winner, root, rule string
	var value int64
	var ends time.Time
	err := w.pool.QueryRow(ctx, `
		SELECT d.market_id, d.contract_address, m.observed_value, m.winning_outcome_id,
		       COALESCE(m.evidence_root, ''), m.rule_hash, m.observation_ends_at
		FROM market_deployments d
		JOIN markets m ON m.id = d.market_id
		WHERE d.chain_id = $1 AND d.state = 'Created' AND `+due+`
		  AND m.status IN ('Result proposed', 'Resolved')
		  AND m.observed_value IS NOT NULL AND m.winning_outcome_id IS NOT NULL
		  AND (SELECT count(*) FROM result_attestations a
		       WHERE a.market_id = d.market_id AND a.chain_id = d.chain_id) >= $2
		ORDER BY m.observation_ends_at
		LIMIT 1`, w.id, w.threshold).Scan(&market, &contract, &value, &winner, &root, &rule, &ends)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find signed results: %w", err)
	}

	result, err := chain.NewResult(market, value, winner, root, rule, ends.Unix())
	if err != nil {
		return w.retry(ctx, market, err)
	}
	digest, err := chain.ResultDigest(big.NewInt(w.id), w.resolver, result)
	if err != nil {
		return w.retry(ctx, market, err)
	}
	signatures, err := w.signatures(ctx, market, digest)
	if err != nil {
		return w.retry(ctx, market, err)
	}
	if len(signatures) < w.threshold {
		return w.retry(ctx, market, fmt.Errorf("%d of %d observers signed this result", len(signatures), w.threshold))
	}

	staked, err := w.number(ctx, contract, chain.TotalPoolCall())
	if err != nil {
		return w.retry(ctx, market, err)
	}
	if staked.Sign() == 0 {
		return w.settled(ctx, market, "Unfunded", "", "nobody took a position")
	}
	backing, err := w.number(ctx, contract, chain.PoolForCall(result.WinningOutcomeID))
	if err != nil {
		return w.retry(ctx, market, err)
	}
	if backing.Sign() == 0 {
		// Settling would void it anyway, with nothing staked on the winner to
		// divide the pool against. Voiding now is one transaction, not two.
		return w.voidOne(ctx, market, contract, "no winning stake")
	}

	data, err := chain.ProposeCall(contract, result, signatures)
	if err != nil {
		return w.retry(ctx, market, err)
	}
	hash, _, err := w.send(ctx, w.resolver, data)
	if err != nil {
		return w.retry(ctx, market, err)
	}

	closes := time.Now().Add(fallbackChallenge)
	if call, err := chain.ChallengeEndsAtCall(contract); err == nil {
		if onChain, err := w.number(ctx, w.resolver, call); err == nil && onChain.Sign() > 0 {
			closes = time.Unix(onChain.Int64(), 0)
		}
	}
	_, err = w.pool.Exec(ctx, `
		UPDATE market_deployments
		SET state = 'Proposed', proposed_tx = $3, challenge_ends_at = $4,
		    attempts = 0, last_error = NULL, updated_at = NOW()
		WHERE market_id = $1 AND chain_id = $2 AND state = 'Created'`, market, w.id, hash, closes)
	if err != nil {
		return fmt.Errorf("record proposal for %s: %w", market, err)
	}
	w.log.Info("result proposed on chain", "market", market, "contract", contract, "tx", hash,
		"challenge_ends", closes.UTC().Format(time.RFC3339))
	return nil
}

func (w *Worker) signatures(ctx context.Context, market string, digest [32]byte) ([][]byte, error) {
	// The resolver takes signers in ascending order, which is how it knows no
	// observer was counted twice. Addresses are all the same length, so their
	// hex sorts the way the numbers do.
	rows, err := w.pool.Query(ctx, `
		SELECT signature FROM result_attestations
		WHERE market_id = $1 AND chain_id = $2 AND digest = $3
		ORDER BY lower(signer)`, market, w.id, "0x"+hex.EncodeToString(digest[:]))
	if err != nil {
		return nil, fmt.Errorf("read attestations: %w", err)
	}
	defer rows.Close()

	var out [][]byte
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return nil, err
		}
		raw, err := hex.DecodeString(strings.TrimPrefix(text, "0x"))
		if err != nil {
			return nil, fmt.Errorf("stored signature: %w", err)
		}
		out = append(out, raw)
	}
	return out, rows.Err()
}

func (w *Worker) finalize(ctx context.Context) error {
	var market, contract string
	err := w.pool.QueryRow(ctx, `
		SELECT d.market_id, d.contract_address
		FROM market_deployments d
		WHERE d.chain_id = $1 AND d.state = 'Proposed' AND `+due+`
		  AND d.challenge_ends_at <= NOW() - INTERVAL '10 seconds'
		ORDER BY d.challenge_ends_at
		LIMIT 1`, w.id).Scan(&market, &contract)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find proposals past their challenge window: %w", err)
	}

	call, err := chain.ObservationStatusCall(contract)
	if err != nil {
		return w.retry(ctx, market, err)
	}
	observation, err := w.number(ctx, w.resolver, call)
	if err != nil {
		return w.retry(ctx, market, err)
	}

	hash := ""
	switch observation.Int64() {
	case observationChallenged, observationInvalid:
		return w.settled(ctx, market, "Voided", "", "voided on chain")
	case observationProposed:
		data, err := chain.FinalizeCall(contract)
		if err != nil {
			return w.retry(ctx, market, err)
		}
		if hash, _, err = w.send(ctx, w.resolver, data); err != nil {
			return w.retry(ctx, market, err)
		}
	}

	status, err := w.number(ctx, contract, chain.StatusCall())
	if err != nil {
		return w.retry(ctx, market, err)
	}
	if status.Int64() == marketInvalid {
		return w.settled(ctx, market, "Voided", hash, "no winning stake")
	}
	return w.settled(ctx, market, "Finalized", hash, "")
}

func (w *Worker) void(ctx context.Context) error {
	var market, contract, reason string
	err := w.pool.QueryRow(ctx, `
		SELECT d.market_id, d.contract_address,
		       CASE WHEN m.status = 'Invalid' THEN 'observation invalid'
		            WHEN m.status IN ('Result proposed', 'Resolved') THEN 'result not attested'
		            ELSE 'never resolved' END
		FROM market_deployments d
		JOIN markets m ON m.id = d.market_id
		WHERE d.chain_id = $1 AND d.state IN ('Created', 'Proposed') AND `+due+`
		  AND (m.status = 'Invalid'
		       OR (d.state = 'Created' AND m.status IN ('Result proposed', 'Resolved')
		           AND m.observation_ends_at < NOW() - $2::interval)
		       OR (d.state = 'Created' AND m.status IN ('Scheduled', 'Open', 'Locked', 'Observing')
		           AND m.observation_ends_at < NOW() - $3::interval))
		ORDER BY m.observation_ends_at
		LIMIT 1`, w.id, unattested.String(), unresolved.String()).Scan(&market, &contract, &reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find deployments to void: %w", err)
	}

	status, err := w.number(ctx, contract, chain.StatusCall())
	if err != nil {
		return w.retry(ctx, market, err)
	}
	switch status.Int64() {
	case marketInvalid:
		return w.settled(ctx, market, "Voided", "", "already void on chain")
	case marketResolved:
		return w.settled(ctx, market, "Finalized", "", "already resolved on chain")
	}
	staked, err := w.number(ctx, contract, chain.TotalPoolCall())
	if err != nil {
		return w.retry(ctx, market, err)
	}
	if staked.Sign() == 0 {
		return w.settled(ctx, market, "Unfunded", "", "nobody took a position")
	}
	return w.voidOne(ctx, market, contract, reason)
}

func (w *Worker) voidOne(ctx context.Context, market, contract, reason string) error {
	code, err := chain.Text32(reason)
	if err != nil {
		return w.retry(ctx, market, err)
	}
	data, err := chain.VoidCall(contract, code)
	if err != nil {
		return w.retry(ctx, market, err)
	}
	hash, _, err := w.send(ctx, w.resolver, data)
	if err != nil {
		return w.retry(ctx, market, err)
	}
	return w.settled(ctx, market, "Voided", hash, reason)
}

func (w *Worker) send(ctx context.Context, to string, data []byte) (string, uint64, error) {
	ctx, cancel := context.WithTimeout(ctx, txTimeout)
	defer cancel()

	hash, err := w.signer.Submit(ctx, w.client, to, data)
	if err != nil {
		return "", 0, err
	}
	receipt, err := w.client.WaitFor(ctx, hash)
	if err != nil {
		return hash, 0, fmt.Errorf("no receipt for %s: %w", hash, err)
	}
	if receipt.Status != 1 {
		return hash, receipt.BlockNumber, fmt.Errorf("%s reverted in block %d", hash, receipt.BlockNumber)
	}
	return hash, receipt.BlockNumber, nil
}

func (w *Worker) created(ctx context.Context, market, address, hash string, block uint64) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE market_deployments
		SET state = 'Created', contract_address = $3, created_tx = NULLIF($4::text, ''),
		    created_block = NULLIF($5::bigint, 0), attempts = 0, last_error = NULL, updated_at = NOW()
		WHERE market_id = $1 AND chain_id = $2 AND state = 'Requested'`,
		market, w.id, address, hash, int64(block))
	if err != nil {
		return fmt.Errorf("record deployment of %s: %w", market, err)
	}
	w.log.Info("market deployed", "market", market, "contract", address, "tx", hash)
	return nil
}

func (w *Worker) settled(ctx context.Context, market, state, hash, note string) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE market_deployments
		SET state = $3, settled_tx = COALESCE(NULLIF($4::text, ''), settled_tx),
		    last_error = NULLIF($5::text, ''), attempts = 0, updated_at = NOW()
		WHERE market_id = $1 AND chain_id = $2`, market, w.id, state, hash, note)
	if err != nil {
		return fmt.Errorf("record %s for %s: %w", state, market, err)
	}
	w.log.Info("deployment settled", "market", market, "state", state, "tx", hash, "note", note)
	return nil
}

func (w *Worker) retry(ctx context.Context, market string, cause error) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE market_deployments
		SET attempts = attempts + 1, last_error = $3, updated_at = NOW()
		WHERE market_id = $1 AND chain_id = $2`, market, w.id, cause.Error())
	if err != nil {
		return errors.Join(cause, err)
	}
	return fmt.Errorf("%s: %w", market, cause)
}

func (w *Worker) number(ctx context.Context, to string, data []byte) (*big.Int, error) {
	raw, err := w.client.Call(ctx, to, data)
	if err != nil {
		return nil, err
	}
	return chain.Uint(raw)
}

func (w *Worker) addressAt(ctx context.Context, to string, data []byte) (string, error) {
	raw, err := w.client.Call(ctx, to, data)
	if err != nil {
		return "", err
	}
	return chain.AddressFromWord(raw)
}

func (w *Worker) marketFor(ctx context.Context, key [32]byte) (string, error) {
	address, err := w.addressAt(ctx, w.factory, chain.MarketForCall(key))
	if err != nil {
		return "", err
	}
	if strings.Trim(strings.TrimPrefix(address, "0x"), "0") == "" {
		return "", nil
	}
	return address, nil
}
