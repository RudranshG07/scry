package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

const (
	baseChainID = 8453

	// short on purpose. most things that spoil a window are a function
	// of how long it is, and both observers have to get through cleanly
	observeWindow = 4 * time.Minute

	// Windows run back to back on a camera with a minute between them: an
	// observer has to file the count it has just taken and be in position for
	// the next window, and a window it joins late it cannot report on.
	restBetweenMarkets = time.Minute

	// The first window on a camera that has none, far enough out that there is
	// something to trade before it locks.
	firstWindowIn = 3 * time.Minute

	// Unlocked markets a camera keeps, so there is always one with minutes left
	// on it rather than only one seconds from locking.
	marketsAhead = 2

	// How long a camera is left alone after failing twice running.
	benchFor = 30 * time.Minute

	historyWindows = 6
	historyMinimum = 3
)

// Rounds the way settle_near in scry_vision/qualify.py does, so a threshold
// reads the same whichever of the two set it.
func settleNear(value float64) int64 {
	if value < 10 {
		return max(1, int64(math.RoundToEven(value)))
	}
	step := 25.0
	switch {
	case value < 100:
		step = 5
	case value < 500:
		step = 10
	}
	return int64(step * math.RoundToEven(value/step))
}

type streamPlan struct {
	id        string
	category  string
	threshold int64
	claim     domain.Claim
	// What this camera already has: markets still open to trade, when the last
	// window it has scheduled ends, and whether anything of its own is running.
	upcoming int
	chainEnd time.Time
	active   bool
}

func observable(c domain.Claim) bool {
	switch c.Kind {
	case "crossings":
		line, ok := c.Options["line"].([]any)
		return ok && len(line) == 2
	case "phrase", "objects":
		return c.Target != ""
	default:
		return false
	}
}

var counted = map[string]string{
	"person":     "people",
	"bicycle":    "bicycles",
	"car":        "cars",
	"motorcycle": "motorcycles",
	"bus":        "buses",
	"truck":      "lorries",
}

func nounFor(c domain.Claim, unit string) string {
	if word, ok := counted[c.Target]; ok {
		return word
	}
	if c.Target == "anything" {
		return "things"
	}
	return unit
}

func questionFor(c domain.Claim, threshold int64, unit string) string {
	switch c.Kind {
	case "phrase":
		if threshold == 1 {
			return fmt.Sprintf("Will %q be said more than once during the observation window?", c.Target)
		}
		return fmt.Sprintf("Will %q be said more than %d times during the observation window?",
			c.Target, threshold)
	case "objects":
		return fmt.Sprintf("Will more than %d %s be counted during the observation window?",
			threshold, c.Target)
	default:
		return fmt.Sprintf("Will more than %d %s cross the count line during the observation window?",
			threshold, nounFor(c, unit))
	}
}

func (e *Engine) schedule(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		SELECT s.id, s.category,
		       COALESCE((s.qualification->>'threshold')::bigint, 180),
		       -- What this camera actually counted lately, when there is enough
		       -- of it: the median of the last few windows both observers read
		       -- cleanly. The qualifier's figure is a 45 s sample scaled up and
		       -- ran two to three times over on every stream it was checked on.
		       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY recent.counted)
		        FROM (SELECT avg(r.observed_value) AS counted
		              FROM markets m
		              JOIN observer_reports r ON r.market_id = m.id
		              WHERE m.stream_id = s.id
		                AND m.observation_ends_at > NOW() - INTERVAL '1 day'
		                AND m.observation_ends_at - m.observation_starts_at = $1::interval
		                AND cardinality(r.invalid_reasons) = 0
		              GROUP BY m.id, m.observation_ends_at
		              HAVING count(DISTINCT r.observer_id) >= $2
		              ORDER BY m.observation_ends_at DESC
		              LIMIT $3) recent
		        HAVING count(*) >= $4),
		       COALESCE(s.default_claim, '{}'::jsonb),
		       (SELECT count(*) FROM markets m
		        WHERE m.stream_id = s.id AND m.status IN ('Scheduled', 'Open')),
		       (SELECT max(m.observation_ends_at) FROM markets m
		        WHERE m.stream_id = s.id
		          AND m.status IN ('Scheduled', 'Open', 'Locked', 'Observing')),
		       EXISTS (SELECT 1 FROM markets m
		               WHERE m.stream_id = s.id
		                 AND m.status IN ('Scheduled', 'Open', 'Locked', 'Observing'))
		FROM streams s
		WHERE s.status = 'Qualified'
		  -- A stream with no source cannot be observed, so a market on it could
		  -- only ever invalidate. Do not open one. An unset source reaches us as
		  -- both NULL and empty text, and empty passes IS NOT NULL.
		  --
		  -- This asks for source_url rather than the relay's playback id, which
		  -- a submitted link never has: observers and the player both resolve
		  -- source_url now, so a stream with one is watchable whether or not the
		  -- relay ever republishes it.
		  AND coalesce(btrim(s.source_url), '') <> ''
		  -- On a quiet camera a single subject moves the count by more than the
		  -- agreement bar, so a result there turns on rounding rather than on
		  -- what anyone observed. The stream stays watchable; it just does not
		  -- take positions until there is enough happening to settle honestly.
		  AND coalesce((s.qualification->>'provisional')::boolean, false) = false
		  -- A camera whose last two windows both failed is left alone for half an
		  -- hour. Every market opened on a feed that is down can only void, and
		  -- one of these dropped its ingest a minute into every window for a
		  -- night while its markets kept being scheduled.
		  AND NOT EXISTS (
		      SELECT 1 FROM (
		          SELECT m.status, m.observation_ends_at FROM markets m
		          WHERE m.stream_id = s.id
		            AND m.status IN ('Resolved', 'Invalid', 'Result proposed', 'Challenged')
		          ORDER BY m.observation_ends_at DESC
		          LIMIT 2
		      ) recent
		      HAVING count(*) = 2
		         AND bool_and(recent.status = 'Invalid')
		         AND max(recent.observation_ends_at) > NOW() - $5::interval
		  )
		ORDER BY s.id`, observeWindow.String(), minObservers, historyWindows, historyMinimum,
		benchFor.String())
	if err != nil {
		return fmt.Errorf("find idle streams: %w", err)
	}
	defer rows.Close()

	var plans []streamPlan
	for rows.Next() {
		var p streamPlan
		var recent *float64
		var chainEnd *time.Time
		if err := rows.Scan(&p.id, &p.category, &p.threshold, &recent, &p.claim,
			&p.upcoming, &chainEnd, &p.active); err != nil {
			return err
		}
		if chainEnd != nil {
			p.chainEnd = *chainEnd
		}
		if recent != nil {
			p.threshold = settleNear(*recent)
		}
		if !observable(p.claim) {
			if !e.warned[p.id] {
				e.warned[p.id] = true
				e.log.Warn("stream has no claim anything can count, not scheduling",
					"stream", p.id, "claim", p.claim.Label())
			}
			continue
		}
		delete(e.warned, p.id)
		plans = append(plans, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range due(plans, e.pairs) {
		if err := e.create(ctx, p); err != nil {
			e.log.Error("could not schedule market", "stream", p.id, "error", err)
		}
	}
	return nil
}

// due picks which cameras to schedule now. One already running keeps its queue
// of unlocked markets topped up; an idle one starts only while an observer pair
// is free to watch it, because a market nobody counts can only void.
func due(plans []streamPlan, cameras int) []streamPlan {
	live := 0
	for _, p := range plans {
		if p.active {
			live++
		}
	}

	out := make([]streamPlan, 0, len(plans))
	for _, p := range plans {
		if p.active {
			if p.upcoming < marketsAhead {
				out = append(out, p)
			}
			continue
		}
		if live >= cameras {
			continue
		}
		live++
		out = append(out, p)
	}
	return out
}

// nextWindow is when the next window on a camera runs: straight after the one
// before it, or a few minutes out when the camera has none. Never in the past,
// however long the camera has been idle.
func nextWindow(now, chainEnd time.Time) (time.Time, time.Time) {
	starts := now.Add(firstWindowIn)
	if queued := chainEnd.Add(restBetweenMarkets); queued.After(starts) {
		starts = queued
	}
	starts = starts.UTC().Truncate(time.Second)
	return starts, starts.Add(observeWindow)
}

func (e *Engine) create(ctx context.Context, p streamPlan) error {
	now := time.Now().UTC()
	locks, ends := nextWindow(now, p.chainEnd)
	// Open the moment it exists. A market that cannot be traded until some later
	// minute is one nobody finds while it is still open.
	opens := now.Truncate(time.Second)

	id := fmt.Sprintf("%s-%d", p.id, locks.Unix())
	question := questionFor(p.claim, p.threshold, domain.UnitFor(p.category))

	options := []byte("{}")
	if len(p.claim.Options) > 0 {
		encoded, err := json.Marshal(p.claim.Options)
		if err != nil {
			return fmt.Errorf("encode claim options: %w", err)
		}
		options = encoded
	}

	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		INSERT INTO markets (id, stream_id, chain_id, question, status, rule_hash,
		                     opens_at, locks_at, observation_starts_at, observation_ends_at,
		                     claim_kind, claim_target, claim_options)
		VALUES ($1, $2, $3, $4, 'Scheduled', $5, $6, $7, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO NOTHING`,
		id, p.id, baseChainID, question, ruleHash(id, p.threshold, ends), opens, locks, ends,
		p.claim.Kind, p.claim.Target, options)
	if err != nil {
		return fmt.Errorf("insert market: %w", err)
	}
	// Already scheduled, which is what a retry after a failed commit looks like.
	if tag.RowsAffected() == 0 {
		return nil
	}

	above := p.threshold + 1
	outcomes := [][]any{
		{id, "yes", fmt.Sprintf("Yes, above %d", p.threshold), &above, nil, 0},
		{id, "no", fmt.Sprintf("No, %d or below", p.threshold), nil, &p.threshold, 1},
	}
	_, err = tx.CopyFrom(ctx,
		pgx.Identifier{"market_outcomes"},
		[]string{"market_id", "outcome_id", "label", "minimum_value", "maximum_value", "sort_order"},
		pgx.CopyFromRows(outcomes))
	if err != nil {
		return fmt.Errorf("insert outcomes: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	e.log.Info("market scheduled", "market", id, "stream", p.id, "locks", locks.Format(time.RFC3339))
	return nil
}

func ruleHash(id string, threshold int64, ends time.Time) string {
	sum := sha256.Sum256(fmt.Appendf(nil, "%s|%d|%d", id, threshold, ends.Unix()))
	return "0x" + hex.EncodeToString(sum[:])
}
