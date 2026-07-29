package engine

import (
	"context"
	"fmt"
)

// advance moves every market whose deadline has passed. The WHERE clause
// carries the current status, so the update only lands once no matter how many
// engines are running.
func (e *Engine) advance(ctx context.Context, from, to, deadline string) error {
	rows, err := e.pool.Query(ctx, fmt.Sprintf(`
		UPDATE markets
		SET status = $1, updated_at = NOW()
		WHERE status = $2 AND %s <= NOW()
		RETURNING id`, deadline), to, from)
	if err != nil {
		return fmt.Errorf("%s -> %s: %w", from, to, err)
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		e.log.Info("market advanced", "market", id, "from", from, "to", to)
		e.notify(ctx, id, to)
	}
	return rows.Err()
}

func (e *Engine) open(ctx context.Context) error {
	return e.advance(ctx, "Scheduled", "Open", "opens_at")
}

func (e *Engine) lock(ctx context.Context) error {
	return e.advance(ctx, "Open", "Locked", "locks_at")
}

func (e *Engine) observe(ctx context.Context) error {
	return e.advance(ctx, "Locked", "Observing", "observation_starts_at")
}

// settle closes the challenge window. Nothing can change the result after this.
func (e *Engine) settle(ctx context.Context) error {
	return e.advance(ctx, "Result proposed", "Resolved", "challenge_ends_at")
}

var headlines = map[string]struct{ title, body string }{
	"Open":            {"Market open", "Positions are open until the market locks."},
	"Locked":          {"Market locked", "No new positions. Observation starts shortly."},
	"Observing":       {"Observation started", "Counting against the published count line."},
	"Result proposed": {"Result proposed", "The challenge window is open."},
	"Resolved":        {"Market resolved", "The result is final and claims are open."},
	"Invalid":         {"Market invalidated", "Observation failed the rule. Principal is refundable."},
}

func (e *Engine) notify(ctx context.Context, market, status string) {
	h, ok := headlines[status]
	if !ok {
		return
	}
	_, err := e.pool.Exec(ctx, `
		INSERT INTO notifications (id, account, kind, market_id, title, body, created_at)
		VALUES ($1, NULL, 'Market', $2, $3, $4, NOW())
		ON CONFLICT (id) DO NOTHING`,
		market+":"+status, market, h.title, h.body)
	if err != nil {
		e.log.Warn("notification not written", "market", market, "error", err)
	}
}
