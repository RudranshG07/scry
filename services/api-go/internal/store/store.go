package store

import (
	"context"
	"errors"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Store interface {
	ListMarkets(context.Context) ([]domain.Market, error)
	GetMarket(context.Context, string) (domain.Market, error)
	GetProof(context.Context, string) (domain.ProofOfObservation, error)
	GetEvidence(context.Context, string, string) (domain.EvidenceBundle, error)
	GetPortfolio(context.Context, string) (domain.Portfolio, error)
	GetLeaderboard(context.Context) ([]domain.LeaderboardEntry, error)
	GetMessages(context.Context, string) ([]domain.RoomMessage, error)
	AddMessage(context.Context, domain.RoomMessage) (domain.RoomMessage, error)
	GetNotifications(context.Context, string) ([]domain.Notification, error)
}
