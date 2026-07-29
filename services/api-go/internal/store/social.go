package store

import (
	"context"
	"fmt"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

func (s *Postgres) GetMessages(ctx context.Context, id string) ([]domain.RoomMessage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, market_id, author_name, author_kind, body, created_at
		FROM room_messages
		WHERE market_id = $1 AND moderated_at IS NULL
		ORDER BY created_at`, id)
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}
	defer rows.Close()

	out := []domain.RoomMessage{}
	for rows.Next() {
		var m domain.RoomMessage
		var at time.Time
		if err := rows.Scan(&m.ID, &m.MarketID, &m.Author, &m.Kind, &m.Body, &at); err != nil {
			return nil, fmt.Errorf("scan messages: %w", err)
		}
		m.CreatedAt = stamp(at)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Postgres) AddMessage(ctx context.Context, m domain.RoomMessage) (domain.RoomMessage, error) {
	at, err := time.Parse(time.RFC3339Nano, m.CreatedAt)
	if err != nil {
		at = time.Now().UTC()
		m.CreatedAt = stamp(at)
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO room_messages (id, market_id, author_id, author_name, author_kind, body, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		m.ID, m.MarketID, m.Author, m.Author, m.Kind, m.Body, at)
	if err != nil {
		return domain.RoomMessage{}, fmt.Errorf("insert message: %w", err)
	}
	return m, nil
}

func (s *Postgres) GetNotifications(ctx context.Context, account string) ([]domain.Notification, error) {
	// A null account is a broadcast, so everyone sees it.
	rows, err := s.pool.Query(ctx, `
		SELECT id, kind, title, body, market_id, created_at
		FROM notifications
		WHERE account IS NULL OR account = $1
		ORDER BY created_at DESC
		LIMIT 50`, account)
	if err != nil {
		return nil, fmt.Errorf("query notifications: %w", err)
	}
	defer rows.Close()

	out := []domain.Notification{}
	for rows.Next() {
		var n domain.Notification
		var at time.Time
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.MarketID, &at); err != nil {
			return nil, fmt.Errorf("scan notifications: %w", err)
		}
		n.CreatedAt = stamp(at)
		out = append(out, n)
	}
	return out, rows.Err()
}
