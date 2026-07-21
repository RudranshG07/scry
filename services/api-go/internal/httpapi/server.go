package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

var addressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

type PlaybackTokenIssuer interface {
	Issue(context.Context, string) (string, error)
}

type Server struct {
	mux           *http.ServeMux
	store         store.Store
	issuer        PlaybackTokenIssuer
	allowedOrigin string
}

func New(data store.Store, issuer PlaybackTokenIssuer, allowedOrigin string) *Server {
	server := &Server{
		mux:           http.NewServeMux(),
		store:         data,
		issuer:        issuer,
		allowedOrigin: strings.TrimSuffix(allowedOrigin, "/"),
	}
	server.routes()
	return server
}

func (server *Server) routes() {
	server.mux.HandleFunc("GET /healthz", server.health)
	server.mux.HandleFunc("GET /v1/markets", server.listMarkets)
	server.mux.HandleFunc("GET /v1/markets/{id}", server.getMarket)
	server.mux.HandleFunc("GET /v1/markets/{id}/proof", server.getProof)
	server.mux.HandleFunc("GET /v1/portfolio/{address}", server.getPortfolio)
	server.mux.HandleFunc("GET /v1/leaderboard", server.getLeaderboard)
	server.mux.HandleFunc("GET /v1/markets/{id}/messages", server.getMessages)
	server.mux.HandleFunc("POST /v1/markets/{id}/messages", server.postMessage)
	server.mux.HandleFunc("GET /v1/notifications", server.getNotifications)
	server.mux.HandleFunc("GET /v1/streams/{id}/playback-token", server.getPlaybackToken)
	server.mux.HandleFunc("GET /v1/markets/{id}/stream", server.marketStream)
}

func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	if origin := request.Header.Get("Origin"); origin != "" && origin == server.allowedOrigin {
		writer.Header().Set("Access-Control-Allow-Origin", origin)
		writer.Header().Set("Access-Control-Allow-Credentials", "true")
		writer.Header().Set("Vary", "Origin")
	}
	if request.Method == http.MethodOptions {
		writer.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
		writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		writer.WriteHeader(http.StatusNoContent)
		return
	}
	server.mux.ServeHTTP(writer, request)
}

func (server *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *Server) listMarkets(writer http.ResponseWriter, request *http.Request) {
	markets, err := server.store.ListMarkets(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "market_store_unavailable", "Markets are temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, markets)
}

func (server *Server) getMarket(writer http.ResponseWriter, request *http.Request) {
	market, err := server.store.GetMarket(request.Context(), request.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "market_not_found", "Market not found.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "market_store_unavailable", "Market is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, market)
}

func (server *Server) getProof(writer http.ResponseWriter, request *http.Request) {
	proof, err := server.store.GetProof(request.Context(), request.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "proof_not_found", "Observation proof not found.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "proof_store_unavailable", "Observation proof is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, proof)
}

func (server *Server) getPortfolio(writer http.ResponseWriter, request *http.Request) {
	address := request.PathValue("address")
	if !addressPattern.MatchString(address) {
		writeError(writer, http.StatusUnprocessableEntity, "invalid_address", "Portfolio address must be a valid EVM address.")
		return
	}
	portfolio, err := server.store.GetPortfolio(request.Context(), address)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "portfolio_store_unavailable", "Portfolio is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, portfolio)
}

func (server *Server) getLeaderboard(writer http.ResponseWriter, request *http.Request) {
	leaderboard, err := server.store.GetLeaderboard(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "leaderboard_unavailable", "Leaderboard is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, leaderboard)
}

func (server *Server) getMessages(writer http.ResponseWriter, request *http.Request) {
	messages, err := server.store.GetMessages(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "message_store_unavailable", "Room activity is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, messages)
}

func (server *Server) postMessage(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 4096)
	var input struct {
		Author string `json:"author"`
		Body   string `json:"body"`
	}
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_message", "Message request is invalid.")
		return
	}
	input.Author = strings.TrimSpace(input.Author)
	input.Body = strings.TrimSpace(input.Body)
	if input.Author == "" || utf8.RuneCountInString(input.Body) < 2 || utf8.RuneCountInString(input.Body) > 160 {
		writeError(writer, http.StatusUnprocessableEntity, "invalid_message", "Author and a 2–160 character message are required.")
		return
	}
	message := domain.RoomMessage{
		ID:        identifier(),
		MarketID:  request.PathValue("id"),
		Author:    input.Author,
		Kind:      "Human",
		Body:      input.Body,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	created, err := server.store.AddMessage(request.Context(), message)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "message_store_unavailable", "Message could not be saved.")
		return
	}
	writeJSON(writer, http.StatusCreated, created)
}

func (server *Server) getNotifications(writer http.ResponseWriter, request *http.Request) {
	notifications, err := server.store.GetNotifications(request.Context(), request.URL.Query().Get("address"))
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "notifications_unavailable", "Notifications are temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, notifications)
}

func (server *Server) getPlaybackToken(writer http.ResponseWriter, request *http.Request) {
	if server.issuer == nil {
		writeError(writer, http.StatusServiceUnavailable, "playback_not_configured", "LiveKit playback is not configured.")
		return
	}
	token, err := server.issuer.Issue(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "playback_unavailable", "Playback authorization is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"token": token})
}

func (server *Server) marketStream(writer http.ResponseWriter, _ *http.Request) {
	writeError(writer, http.StatusNotImplemented, "realtime_not_configured", "Realtime market streaming is not configured.")
}

func identifier() string {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(value)
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, status int, code string, message string) {
	writeJSON(writer, status, map[string]string{"code": code, "error": message})
}
