package httpapi_test

import (
	"context"
	"sync"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

// emptyStore stands in for a database so the handlers can be exercised without
// one. It lives in the test binary on purpose: an in-memory store used to ship
// in the store package, and anything that can serve markets nobody observed
// eventually does.
type emptyStore struct {
	mu       sync.RWMutex
	messages map[string][]domain.RoomMessage
}

func newEmptyStore() *emptyStore {
	return &emptyStore{messages: map[string][]domain.RoomMessage{}}
}

func (s *emptyStore) ListMarkets(context.Context) ([]domain.Market, error) {
	return []domain.Market{}, nil
}

func (s *emptyStore) GetMarket(context.Context, string) (domain.Market, error) {
	return domain.Market{}, store.ErrNotFound
}

func (s *emptyStore) GetProof(context.Context, string) (domain.ProofOfObservation, error) {
	return domain.ProofOfObservation{}, store.ErrNotFound
}

func (s *emptyStore) GetEvidence(context.Context, string, string) (domain.EvidenceBundle, error) {
	return domain.EvidenceBundle{}, store.ErrNotFound
}

func (s *emptyStore) GetPortfolio(_ context.Context, address string) (domain.Portfolio, error) {
	return domain.Portfolio{Address: address, Positions: []domain.Position{}}, nil
}

func (s *emptyStore) GetLeaderboard(context.Context) ([]domain.LeaderboardEntry, error) {
	return []domain.LeaderboardEntry{}, nil
}

func (s *emptyStore) GetMessages(_ context.Context, marketID string) ([]domain.RoomMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]domain.RoomMessage{}, s.messages[marketID]...), nil
}

func (s *emptyStore) AddMessage(_ context.Context, message domain.RoomMessage) (domain.RoomMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages[message.MarketID] = append(s.messages[message.MarketID], message)
	return message, nil
}

func (s *emptyStore) GetNotifications(context.Context, string) ([]domain.Notification, error) {
	return []domain.Notification{}, nil
}
