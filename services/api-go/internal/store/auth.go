package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	nonceLifetime   = 10 * time.Minute
	sessionLifetime = 14 * 24 * time.Hour
)

var ErrNonceUnknown = errors.New("nonce is unknown, expired, or already used")

// IssueNonce mints a one-time challenge for an address.
func (s *Postgres) IssueNonce(ctx context.Context, address string) (string, error) {
	nonce, err := token(16)
	if err != nil {
		return "", err
	}

	now := time.Now().UTC()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO auth_nonces (nonce, address, issued_at, expires_at)
		VALUES ($1, $2, $3, $4)`,
		nonce, normalise(address), now, now.Add(nonceLifetime))
	if err != nil {
		return "", fmt.Errorf("issue nonce: %w", err)
	}
	return nonce, nil
}

// ConsumeNonce spends a nonce once. The single guarded UPDATE is the mechanism:
// separate check and mark would leave a gap for replay.
func (s *Postgres) ConsumeNonce(ctx context.Context, nonce, address string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE auth_nonces SET consumed_at = NOW()
		WHERE nonce = $1 AND address = $2 AND consumed_at IS NULL AND expires_at > NOW()`,
		nonce, normalise(address))
	if err != nil {
		return fmt.Errorf("consume nonce: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNonceUnknown
	}
	return nil
}

// StartSession returns the bearer token and stores only its digest, so reading
// the table cannot mint a cookie.
func (s *Postgres) StartSession(ctx context.Context, address string) (string, time.Time, error) {
	raw, err := token(32)
	if err != nil {
		return "", time.Time{}, err
	}

	now := time.Now().UTC()
	expires := now.Add(sessionLifetime)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO sessions (token_digest, address, created_at, expires_at)
		VALUES ($1, $2, $3, $4)`,
		Digest(raw), normalise(address), now, expires)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("start session: %w", err)
	}
	return raw, expires, nil
}

// AddressForSession returns who the caller is, or ErrNotFound.
func (s *Postgres) AddressForSession(ctx context.Context, raw string) (string, error) {
	var address string
	err := s.pool.QueryRow(ctx, `
		SELECT address FROM sessions
		WHERE token_digest = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
		Digest(raw)).Scan(&address)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read session: %w", err)
	}
	return address, nil
}

func (s *Postgres) EndSession(ctx context.Context, raw string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions SET revoked_at = NOW()
		WHERE token_digest = $1 AND revoked_at IS NULL`, Digest(raw))
	if err != nil {
		return fmt.Errorf("end session: %w", err)
	}
	return nil
}

func Digest(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func token(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read entropy: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// Wallets send mixed case; one casing keeps session, nonce and position aligned.
func normalise(address string) string {
	return strings.ToLower(strings.TrimSpace(address))
}
