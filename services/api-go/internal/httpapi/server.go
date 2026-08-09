package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
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
	mux            *http.ServeMux
	store          store.Store
	issuer         PlaybackTokenIssuer
	allowedOrigins []string
	domain         string
	secureCookies  bool
	// Lets Scry post its own streams without a wallet. Unset means only signed-in
	// people can submit, which is the right default: an empty token must never
	// authenticate an empty header.
	operatorToken string
	log           *slog.Logger
}

func New(data store.Store, issuer PlaybackTokenIssuer, allowedOrigin string) *Server {
	origins := splitOrigins(allowedOrigin)
	server := &Server{
		mux:            http.NewServeMux(),
		store:          data,
		issuer:         issuer,
		allowedOrigins: origins,
		// The domain in a sign-in message has to be the site the user is actually
		// on, or the check that a signature was meant for us proves nothing.
		domain: hostOf(origins[0]),
		// A session cookie sent in the clear is a session anyone on the path can
		// take, but localhost has no certificate to offer.
		secureCookies: strings.HasPrefix(origins[0], "https://"),
		operatorToken: strings.TrimSpace(os.Getenv("SCRY_OPERATOR_TOKEN")),
		log:           slog.Default(),
	}
	server.routes()
	return server
}

func (server *Server) routes() {
	server.mux.HandleFunc("GET /healthz", server.health)
	server.mux.HandleFunc("GET /v1/markets", server.listMarkets)
	server.mux.HandleFunc("GET /v1/markets/{id}", server.getMarket)
	server.mux.HandleFunc("GET /v1/markets/{id}/proof", server.getProof)
	server.mux.HandleFunc("GET /v1/markets/{id}/evidence/{observer}", server.getEvidence)
	server.mux.HandleFunc("GET /v1/portfolio/{address}", server.getPortfolio)
	server.mux.HandleFunc("GET /v1/leaderboard", server.getLeaderboard)
	server.mux.HandleFunc("GET /v1/markets/{id}/messages", server.getMessages)
	server.mux.HandleFunc("POST /v1/markets/{id}/messages", server.postMessage)
	server.mux.HandleFunc("GET /v1/notifications", server.getNotifications)
	server.mux.HandleFunc("GET /v1/streams/{id}/playback-token", server.getPlaybackToken)
	server.mux.HandleFunc("GET /v1/streams", server.getStreams)
	server.mux.HandleFunc("POST /v1/streams", server.postStream)
	server.mux.HandleFunc("GET /v1/streams/pending", server.getPendingStreams)
	server.mux.HandleFunc("POST /v1/streams/{id}/qualification", server.postQualification)
	server.mux.HandleFunc("GET /v1/markets/{id}/stream", server.marketStream)
	server.mux.HandleFunc("POST /v1/markets/{id}/observations", server.postObservation)
	server.mux.HandleFunc("POST /v1/auth/nonce", server.postNonce)
	server.mux.HandleFunc("POST /v1/auth/session", server.postSession)
	server.mux.HandleFunc("GET /v1/auth/session", server.getSession)
	server.mux.HandleFunc("DELETE /v1/auth/session", server.deleteSession)
}

func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	if origin := request.Header.Get("Origin"); origin != "" && server.allows(origin) {
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

func (server *Server) getEvidence(writer http.ResponseWriter, request *http.Request) {
	bundle, err := server.store.GetEvidence(request.Context(),
		request.PathValue("id"), request.PathValue("observer"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "evidence_not_found", "No evidence bundle for this observer.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "evidence_store_unavailable", "Evidence is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, bundle)
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

// hostOf strips scheme and port so the sign-in domain matches what a wallet
// shows the user.
func hostOf(origin string) string {
	trimmed := strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
	if host, _, found := strings.Cut(trimmed, ":"); found {
		return host
	}
	return trimmed
}

// splitOrigins accepts a comma-separated list. Browsers treat http://localhost
// and http://127.0.0.1 as different origins, so a dev setup that names only one
// blocks the other with a CORS error that looks like the API being down.
func splitOrigins(configured string) []string {
	var out []string
	for _, part := range strings.Split(configured, ",") {
		if trimmed := strings.TrimSuffix(strings.TrimSpace(part), "/"); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		out = append(out, "http://127.0.0.1:3000")
	}
	return out
}

func (server *Server) allows(origin string) bool {
	for _, allowed := range server.allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

// hostPortOf strips the scheme but keeps the port, which is what websocket
// origin matching compares against.
func hostPortOf(origin string) string {
	return strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
}
