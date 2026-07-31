package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/auth"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

const sessionCookie = "scry_session"

// Sessions is the part of the store sign-in needs. Keeping it narrow means the
// handlers cannot reach for market data by accident.
type Sessions interface {
	IssueNonce(context.Context, string) (string, error)
	ConsumeNonce(context.Context, string, string) error
	StartSession(context.Context, string) (string, time.Time, error)
	AddressForSession(context.Context, string) (string, error)
	EndSession(context.Context, string) error
}

func (server *Server) postNonce(writer http.ResponseWriter, request *http.Request) {
	sessions, ok := server.store.(Sessions)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "auth_unavailable", "Sign-in needs a database.")
		return
	}

	var body struct {
		Address string `json:"address"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil || !addressPattern.MatchString(body.Address) {
		writeError(writer, http.StatusBadRequest, "bad_address", "Provide a wallet address.")
		return
	}

	nonce, err := sessions.IssueNonce(request.Context(), body.Address)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "auth_unavailable", "Could not start sign-in.")
		return
	}

	issued := time.Now().UTC().Format(time.RFC3339)
	writeJSON(writer, http.StatusOK, map[string]string{
		"nonce":    nonce,
		"issuedAt": issued,
		// The server composes the text to be signed. Letting the client supply it
		// would mean signing whatever it decided to put in front of the user.
		"message": auth.Build(server.domain, strings.ToLower(body.Address), nonce, issued,
			"Sign in to Scry. This proves you control this wallet and costs nothing."),
	})
}

func (server *Server) postSession(writer http.ResponseWriter, request *http.Request) {
	sessions, ok := server.store.(Sessions)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "auth_unavailable", "Sign-in needs a database.")
		return
	}

	var body struct {
		Address   string `json:"address"`
		Message   string `json:"message"`
		Signature string `json:"signature"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil || !addressPattern.MatchString(body.Address) {
		writeError(writer, http.StatusBadRequest, "bad_request", "Provide address, message and signature.")
		return
	}

	parsed, err := auth.Parse(body.Message)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "bad_message", "That is not a sign-in message.")
		return
	}

	// Spend the nonce before checking the signature. A signature that fails
	// verification has still exposed the nonce, and leaving it live would let it
	// be tried again.
	if err := sessions.ConsumeNonce(request.Context(), parsed.Nonce, body.Address); err != nil {
		writeError(writer, http.StatusUnauthorized, "nonce_spent", "This sign-in has expired. Try again.")
		return
	}

	if err := auth.Verify(body.Message, body.Signature, server.domain, body.Address, parsed.Nonce); err != nil {
		writeError(writer, http.StatusUnauthorized, "bad_signature", "That signature does not match the address.")
		return
	}

	raw, expires, err := sessions.StartSession(request.Context(), body.Address)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "auth_unavailable", "Could not start a session.")
		return
	}

	http.SetCookie(writer, &http.Cookie{
		Name:  sessionCookie,
		Value: raw,
		Path:  "/",
		// The token never needs to be read by scripts, so it is kept out of their
		// reach; SameSite blocks another site from spending it on the user's behalf.
		HttpOnly: true,
		Secure:   server.secureCookies,
		SameSite: http.SameSiteLaxMode,
		Expires:  expires,
	})
	writeJSON(writer, http.StatusOK, map[string]string{
		"address":   strings.ToLower(body.Address),
		"expiresAt": expires.Format(time.RFC3339),
	})
}

func (server *Server) getSession(writer http.ResponseWriter, request *http.Request) {
	address, ok := server.caller(request)
	if !ok {
		writeError(writer, http.StatusUnauthorized, "not_signed_in", "Sign in to continue.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"address": address})
}

func (server *Server) deleteSession(writer http.ResponseWriter, request *http.Request) {
	if sessions, ok := server.store.(Sessions); ok {
		if cookie, err := request.Cookie(sessionCookie); err == nil {
			_ = sessions.EndSession(request.Context(), cookie.Value)
		}
	}
	http.SetCookie(writer, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", HttpOnly: true,
		Secure: server.secureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
	writer.WriteHeader(http.StatusNoContent)
}

// caller returns the signed-in address, if there is one.
func (server *Server) caller(request *http.Request) (string, bool) {
	sessions, ok := server.store.(Sessions)
	if !ok {
		return "", false
	}
	cookie, err := request.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return "", false
	}
	address, err := sessions.AddressForSession(request.Context(), cookie.Value)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			server.log.Error("session lookup failed", "error", err)
		}
		return "", false
	}
	return address, true
}
