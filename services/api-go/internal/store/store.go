package store

import (
	"context"
	"errors"
	"sync"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Store interface {
	ListMarkets(context.Context) ([]domain.Market, error)
	GetMarket(context.Context, string) (domain.Market, error)
	GetProof(context.Context, string) (domain.ProofOfObservation, error)
	GetPortfolio(context.Context, string) (domain.Portfolio, error)
	GetLeaderboard(context.Context) ([]domain.LeaderboardEntry, error)
	GetMessages(context.Context, string) ([]domain.RoomMessage, error)
	AddMessage(context.Context, domain.RoomMessage) (domain.RoomMessage, error)
	GetNotifications(context.Context, string) ([]domain.Notification, error)
}

type Memory struct {
	mu       sync.RWMutex
	markets  map[string]domain.Market
	proofs   map[string]domain.ProofOfObservation
	messages map[string][]domain.RoomMessage
}

func NewMemory() *Memory {
	return &Memory{
		markets:  make(map[string]domain.Market),
		proofs:   make(map[string]domain.ProofOfObservation),
		messages: make(map[string][]domain.RoomMessage),
	}
}

func (memory *Memory) ListMarkets(context.Context) ([]domain.Market, error) {
	memory.mu.RLock()
	defer memory.mu.RUnlock()
	markets := make([]domain.Market, 0, len(memory.markets))
	for _, market := range memory.markets {
		markets = append(markets, market)
	}
	return markets, nil
}

func (memory *Memory) GetMarket(_ context.Context, id string) (domain.Market, error) {
	memory.mu.RLock()
	defer memory.mu.RUnlock()
	market, exists := memory.markets[id]
	if !exists {
		return domain.Market{}, ErrNotFound
	}
	return market, nil
}

func (memory *Memory) GetProof(_ context.Context, marketID string) (domain.ProofOfObservation, error) {
	memory.mu.RLock()
	defer memory.mu.RUnlock()
	proof, exists := memory.proofs[marketID]
	if !exists {
		return domain.ProofOfObservation{}, ErrNotFound
	}
	return proof, nil
}

func (memory *Memory) GetPortfolio(_ context.Context, address string) (domain.Portfolio, error) {
	return domain.Portfolio{Address: address, Positions: []domain.Position{}}, nil
}

func (memory *Memory) GetLeaderboard(context.Context) ([]domain.LeaderboardEntry, error) {
	return []domain.LeaderboardEntry{}, nil
}

func (memory *Memory) GetMessages(_ context.Context, marketID string) ([]domain.RoomMessage, error) {
	memory.mu.RLock()
	defer memory.mu.RUnlock()
	messages := memory.messages[marketID]
	return append([]domain.RoomMessage{}, messages...), nil
}

func (memory *Memory) AddMessage(_ context.Context, message domain.RoomMessage) (domain.RoomMessage, error) {
	memory.mu.Lock()
	defer memory.mu.Unlock()
	memory.messages[message.MarketID] = append(memory.messages[message.MarketID], message)
	return message, nil
}

func (memory *Memory) GetNotifications(context.Context, string) ([]domain.Notification, error) {
	return []domain.Notification{}, nil
}
