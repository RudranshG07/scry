package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"
)

const (
	minWindows   = 4
	minAgreement = 0.75
	// Suspension stops scheduling, which stops the windows needed to recover.
	probation = 2 * time.Hour
)

type window struct{ lo, hi int64 }

// qualify suspends streams whose observers cannot agree. Uptime and contrast
// only say the footage arrived; a result rests on two of them agreeing.
func (e *Engine) qualify(ctx context.Context) error {
	if err := e.unsourced(ctx); err != nil {
		return err
	}
	if err := e.reinstate(ctx); err != nil {
		return err
	}

	// Only windows since the last decision, or a reinstated stream is judged on
	// the readings that suspended it.
	rows, err := e.pool.Query(ctx, `
		WITH w AS (
		    SELECT m.stream_id,
		           min(r.observed_value) AS lo,
		           max(r.observed_value) AS hi,
		           row_number() OVER (PARTITION BY m.stream_id
		                              ORDER BY m.observation_ends_at DESC) AS recency
		    FROM markets m
		    JOIN streams s ON s.id = m.stream_id
		    JOIN observer_reports r ON r.market_id = m.id
		    WHERE m.status IN ('Resolved', 'Result proposed', 'Invalid')
		      AND cardinality(r.invalid_reasons) = 0
		      AND m.observation_ends_at > COALESCE(
		          (s.qualification->>'checkedAt')::timestamptz, '-infinity')
		    GROUP BY m.stream_id, m.id, m.observation_ends_at
		    HAVING count(DISTINCT r.observer_id) >= $1
		)
		SELECT s.id, s.status, w.lo, w.hi
		FROM streams s
		JOIN w ON w.stream_id = s.id
		WHERE s.status IN ('Qualified', 'Suspended') AND w.recency <= $2
		ORDER BY s.id, w.recency`, minObservers, minWindows)
	if err != nil {
		return fmt.Errorf("read agreement history: %w", err)
	}
	defer rows.Close()

	var order []string
	status := map[string]string{}
	seen := map[string][]window{}
	for rows.Next() {
		var id, st string
		var w window
		if err := rows.Scan(&id, &st, &w.lo, &w.hi); err != nil {
			return err
		}
		if _, ok := seen[id]; !ok {
			order = append(order, id)
			status[id] = st
		}
		seen[id] = append(seen[id], w)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range order {
		want, agreed, ok := verdict(seen[id])
		if !ok || want == status[id] {
			continue
		}
		ws := seen[id]
		rate := float64(agreed) / float64(len(ws))
		if err := e.setStatus(ctx, id, want, agreed, len(ws), rate); err != nil {
			e.log.Error("could not update stream status", "stream", id, "error", err)
		}
	}
	return nil
}

// verdict returns false when there is not enough history to judge, which is not
// the same as a pass.
func verdict(ws []window) (string, int, bool) {
	if len(ws) < minWindows {
		return "", 0, false
	}
	agreed := 0
	for _, w := range ws {
		if w.hi-w.lo <= allowedSpread(w.lo) {
			agreed++
		}
	}
	if float64(agreed)/float64(len(ws)) < minAgreement {
		return "Suspended", agreed, true
	}
	return "Qualified", agreed, true
}

// unsourced demotes streams nobody can watch, which would sit Qualified forever
// and never publish.
func (e *Engine) unsourced(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		UPDATE streams SET status = 'Candidate', updated_at = NOW()
		WHERE status IN ('Qualified', 'Suspended')
		  AND coalesce(btrim(public_playback_id), '') = ''
		RETURNING id`)
	if err != nil {
		return fmt.Errorf("demote unsourced streams: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		e.log.Warn("stream has no playback source", "stream", id, "status", "Candidate")
	}
	return rows.Err()
}

// reinstate clears the window history too, so a stream is judged on what it
// does next rather than on why it was suspended.
//
// Coming off probation means looking again, not assuming the camera came back.
// It returns provisional and with its last inspection forgotten, so the sweep
// picks it up and the scheduler leaves it alone until something has actually
// watched it. Reinstating straight to Qualified put dead links back to work:
// a camera whose stream had ended kept its "could not find a live stream"
// reason, opened markets nobody could watch, and churned through invalidating
// them until it was suspended again two hours later.
func (e *Engine) reinstate(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		UPDATE streams
		SET status = 'Qualified',
		    qualification = (qualification - 'inspectedAt' - 'reason') || jsonb_build_object(
		        'checkedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        'onProbation', true,
		        'provisional', true),
		    updated_at = NOW()
		WHERE status = 'Suspended'
		  AND (qualification->>'checkedAt')::timestamptz < NOW() - $1::interval
		RETURNING id`, probation.String())
	if err != nil {
		return fmt.Errorf("reinstate streams: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		e.log.Info("stream off probation", "stream", id)
	}
	return rows.Err()
}

func (e *Engine) setStatus(ctx context.Context, id, want string, agreed, total int, rate float64) error {
	note, err := json.Marshal(map[string]any{
		"windows":   total,
		"agreed":    agreed,
		"rate":      math.Round(rate*1000) / 10,
		"checkedAt": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}

	tag, err := e.pool.Exec(ctx, `
		UPDATE streams
		SET status = $2, qualification = qualification || $3::jsonb, updated_at = NOW()
		WHERE id = $1 AND status <> $2`, id, want, note)
	if err != nil {
		return fmt.Errorf("set stream status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil
	}

	e.log.Warn("stream requalified", "stream", id, "status", want,
		"agreed", agreed, "windows", total)
	return nil
}
