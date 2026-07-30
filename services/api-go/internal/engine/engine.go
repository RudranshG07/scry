// Package engine advances markets through their lifecycle. It owns the clock:
// nothing else in the system decides when a market opens, locks or settles.
package engine

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Engine struct {
	pool *pgxpool.Pool
	tick time.Duration
	log  *slog.Logger
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Engine {
	return &Engine{pool: pool, tick: time.Second, log: log}
}

func (e *Engine) Run(ctx context.Context) {
	t := time.NewTicker(e.tick)
	defer t.Stop()

	e.step(ctx)
	for {
		select {
		case <-ctx.Done():
			e.log.Info("engine stopped")
			return
		case <-t.C:
			e.step(ctx)
		}
	}
}

// step is deliberately idempotent. Every transition is a guarded UPDATE, so a
// second engine running against the same database is harmless — one of them
// wins the row and the other sees no rows affected.
func (e *Engine) step(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	for _, job := range []struct {
		name string
		run  func(context.Context) error
	}{
		{"open", e.open},
		{"lock", e.lock},
		{"observe", e.observe},
		{"propose", e.propose},
		{"settle", e.settle},
		{"qualify", e.qualify},
		{"schedule", e.schedule},
		{"history", e.history},
	} {
		if err := job.run(ctx); err != nil {
			e.log.Error("engine job failed", "job", job.name, "error", err)
		}
	}
}
