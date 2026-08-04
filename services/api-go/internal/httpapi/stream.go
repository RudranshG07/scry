package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

const streamInterval = 2 * time.Second

type marketUpdate struct {
	Type        string  `json:"type"`
	MarketID    string  `json:"marketId"`
	OutcomeID   string  `json:"outcomeId,omitempty"`
	Probability float64 `json:"probability,omitempty"`
	Count       int64   `json:"count,omitempty"`
	Rate        float64 `json:"rate,omitempty"`
	Status      string  `json:"status,omitempty"`
	RecordedAt  string  `json:"recordedAt"`
}

func (server *Server) marketStream(writer http.ResponseWriter, request *http.Request) {
	marketID := request.PathValue("id")

	// OriginPatterns is matched against the Origin header's host, which keeps its
	// port. Only the scheme comes off: dropping the port too would leave
	// "localhost" failing to match "localhost:3000" and reject every handshake.
	patterns := make([]string, 0, len(server.allowedOrigins))
	for _, origin := range server.allowedOrigins {
		patterns = append(patterns, hostPortOf(origin))
	}
	socket, err := websocket.Accept(writer, request, &websocket.AcceptOptions{
		OriginPatterns: patterns,
	})
	if err != nil {
		return
	}
	defer socket.CloseNow()

	ctx := request.Context()
	ticker := time.NewTicker(streamInterval)
	defer ticker.Stop()

	var lastStatus string
	var lastProbability float64

	push := func() error {
		queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()

		market, err := server.store.GetMarket(queryCtx, marketID)
		if errors.Is(err, store.ErrNotFound) {
			return socket.Close(websocket.StatusNormalClosure, "market not found")
		}
		if err != nil {
			return err
		}

		now := time.Now().UTC().Format(time.RFC3339Nano)

		if observed := observedCount(market); observed > 0 {
			if err := wsjson.Write(ctx, socket, marketUpdate{
				Type: "market.count", MarketID: market.ID,
				Count: observed, Rate: market.CurrentRate, RecordedAt: now,
			}); err != nil {
				return err
			}
		}

		if len(market.Outcomes) > 0 {
			leading := market.Outcomes[0]
			if leading.Probability != lastProbability {
				lastProbability = leading.Probability
				if err := wsjson.Write(ctx, socket, marketUpdate{
					Type: "market.probability", MarketID: market.ID,
					OutcomeID: leading.ID, Probability: leading.Probability, RecordedAt: now,
				}); err != nil {
					return err
				}
			}
		}

		if market.Status != lastStatus {
			lastStatus = market.Status
			if err := wsjson.Write(ctx, socket, marketUpdate{
				Type: "market.status", MarketID: market.ID,
				Status: market.Status, RecordedAt: now,
			}); err != nil {
				return err
			}
		}
		return nil
	}

	if err := push(); err != nil {
		return
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := push(); err != nil {
				if !errors.Is(err, context.Canceled) {
					slog.Debug("market stream closed", "market", marketID, "error", err)
				}
				return
			}
		}
	}
}

func observedCount(market domain.Market) int64 {
	if market.ObservedValue != nil {
		return *market.ObservedValue
	}
	return 0
}
