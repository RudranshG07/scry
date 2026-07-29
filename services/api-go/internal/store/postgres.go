package store

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(ctx context.Context, dsn string) (*Postgres, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	cfg.MaxConns = 16
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 15 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

func (s *Postgres) Close() { s.pool.Close() }

// Pool exposes the connection for the engine, which writes rather than reads
// and so does not go through the Store interface.
func (s *Postgres) Pool() *pgxpool.Pool { return s.pool }

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func stampOrNil(t *time.Time) *string {
	if t == nil {
		return nil
	}
	out := stamp(*t)
	return &out
}

func round(v float64, places int) float64 {
	f := math.Pow(10, float64(places))
	return math.Round(v*f) / f
}

// pgx hands back a nil slice for no rows, which marshals to null, not [].
func filled[T any](in []T) []T {
	if in == nil {
		return []T{}
	}
	return in
}
