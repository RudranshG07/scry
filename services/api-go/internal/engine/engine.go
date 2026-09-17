package engine

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Engine struct {
	pool   *pgxpool.Pool
	tick   time.Duration
	log    *slog.Logger
	warned map[string]bool
	pairs  int
	chains []int64
}

func New(pool *pgxpool.Pool, log *slog.Logger, pairs int, chains []int64) *Engine {
	if pairs < 1 {
		pairs = 1
	}
	return &Engine{pool: pool, tick: time.Second, log: log, warned: map[string]bool{}, pairs: pairs, chains: chains}
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
