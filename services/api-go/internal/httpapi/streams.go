package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

// Inspections is the part of the store re-qualification needs.
type Inspections interface {
	PendingQualification(context.Context, time.Duration) ([]domain.StreamSource, error)
	RecordQualification(context.Context, string, domain.Qualification) error
}

// Watchable is the part of the store that says which streams can host a market.
type Watchable interface {
	Watchable(context.Context) ([]domain.StreamSource, error)
}

func (server *Server) getStreams(writer http.ResponseWriter, request *http.Request) {
	store, ok := server.store.(Watchable)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "streams_unavailable", "Listing streams needs a database.")
		return
	}

	streams, err := store.Watchable(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "stream_store_unavailable", "Streams are temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, streams)
}

// Submissions is the part of the store the front door needs.
type Submissions interface {
	SubmitStream(context.Context, domain.StreamSubmission, string) (domain.StreamSource, error)
}

func (server *Server) postStream(writer http.ResponseWriter, request *http.Request) {
	store, ok := server.store.(Submissions)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "submission_unavailable", "Submitting a stream needs a database.")
		return
	}

	// Submissions are attributed, so a link that turns out to be someone's
	// living room has a name against it. Scry posts its own streams too, and
	// those carry an operator token rather than a wallet.
	address, ok := server.submitter(request)
	if !ok {
		writeError(writer, http.StatusUnauthorized, "not_signed_in", "Sign in to submit a stream.")
		return
	}

	var body domain.StreamSubmission
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "bad_submission", "Provide a link to a live stream.")
		return
	}

	body.SourceURL = strings.TrimSpace(body.SourceURL)
	parsed, err := url.Parse(body.SourceURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeError(writer, http.StatusBadRequest, "bad_link", "A stream link has to be an http or https url.")
		return
	}

	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeError(writer, http.StatusBadRequest, "name_required", "Say what this camera is looking at.")
		return
	}
	if body.Timezone == "" {
		body.Timezone = "UTC"
	}
	if _, err := time.LoadLocation(body.Timezone); err != nil {
		writeError(writer, http.StatusBadRequest, "bad_timezone", "Use an IANA time zone such as Europe/London.")
		return
	}
	if body.Category == "" {
		body.Category = "Traffic"
	}
	if body.Region == "" {
		body.Region = "Unknown"
	}

	// The claim is checked here rather than at scheduling because a submitter
	// who drew no line gets told now, instead of watching a stream sit
	// Candidate forever with nothing explaining why.
	if reason, ok := countable(body.Claim); !ok {
		writeError(writer, http.StatusBadRequest, "claim_uncountable", reason)
		return
	}

	stream, err := store.SubmitStream(request.Context(), body, address)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "stream_store_unavailable", "Streams are temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusAccepted, stream)
}

// countable mirrors what the observers can actually run, so a submission is
// refused at the door rather than accepted and silently never scheduled.
func countable(c domain.Claim) (string, bool) {
	switch c.Kind {
	case "crossings":
		line, ok := c.Options["line"].([]any)
		if !ok || len(line) != 2 {
			return "Draw a count line: two points across whatever you want counted.", false
		}
		return "", true
	case "phrase", "objects":
		if strings.TrimSpace(c.Target) == "" {
			return "Say what to count — a phrase to listen for, or a thing to look for.", false
		}
		return "", true
	default:
		return "Scry can count things crossing a line, things in view, or a phrase being said.", false
	}
}

// A link that qualified on submission can be offline, re-aimed or dark a week
// later, so every stream is looked at again on this cadence.
const inspectEvery = 6 * time.Hour

func (server *Server) getPendingStreams(writer http.ResponseWriter, request *http.Request) {
	store, ok := server.store.(Inspections)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "inspection_unavailable", "Stream inspection needs a database.")
		return
	}

	due, err := store.PendingQualification(request.Context(), inspectEvery)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "stream_store_unavailable", "Streams are temporarily unavailable.")
		return
	}
	if due == nil {
		due = []domain.StreamSource{}
	}
	writeJSON(writer, http.StatusOK, due)
}

func (server *Server) postQualification(writer http.ResponseWriter, request *http.Request) {
	store, ok := server.store.(Inspections)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "inspection_unavailable", "Stream inspection needs a database.")
		return
	}

	var body domain.Qualification
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "bad_qualification", "Provide the result of an inspection.")
		return
	}
	if body.Reason == "" {
		writeError(writer, http.StatusBadRequest, "reason_required", "An inspection has to say why.")
		return
	}

	if err := store.RecordQualification(request.Context(), request.PathValue("id"), body); err != nil {
		writeError(writer, http.StatusInternalServerError, "stream_store_unavailable", "Streams are temporarily unavailable.")
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// submitter is whoever is adding this stream: a signed-in address, or Scry
// itself holding the operator token.
func (server *Server) submitter(request *http.Request) (string, bool) {
	if address, ok := server.caller(request); ok {
		return address, true
	}
	// An unset token would otherwise match a request that sent no token, which
	// turns the front door into an open one on any deployment that forgot to
	// configure it.
	if server.operatorToken == "" {
		return "", false
	}
	offered := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(offered), []byte(server.operatorToken)) == 1 {
		return "scry:operator", true
	}
	return "", false
}
