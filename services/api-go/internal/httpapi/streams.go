package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

type Inspections interface {
	PendingQualification(context.Context, time.Duration) ([]domain.StreamSource, error)
	RecordQualification(context.Context, string, domain.Qualification) error
}

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

type Submissions interface {
	SubmitStream(context.Context, domain.StreamSubmission, string) (domain.StreamSource, error)
}

func (server *Server) postStream(writer http.ResponseWriter, request *http.Request) {
	store, ok := server.store.(Submissions)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "submission_unavailable", "Submitting a stream needs a database.")
		return
	}

	address, ok := server.submitter(request)
	if !ok {
		writeError(writer, http.StatusUnauthorized, "not_signed_in", "Sign in to submit a stream.")
		return
	}

	// Every submission costs an inspection: a minute of a stream pulled and run
	// through two models. Anyone may submit, but not without end.
	if quota, ok := server.store.(SubmissionQuota); ok && address != operatorSubmitter {
		submitted, err := quota.SubmittedSince(request.Context(), address, 24*time.Hour)
		if err == nil && submitted >= submissionsPerDay {
			writeError(writer, http.StatusTooManyRequests, "too_many_submissions",
				"This wallet has submitted enough streams for today. Try again tomorrow.")
			return
		}
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
	category, known := categoryFor(body)
	if !known {
		writeError(writer, http.StatusBadRequest, "bad_category", "Pick one of Scry's categories.")
		return
	}
	body.Category = category
	if body.Region == "" {
		body.Region = "Unknown"
	}

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
			return "Say what to count: a phrase to listen for, or a thing to look for.", false
		}
		return "", true
	default:
		return "Scry can count things crossing a line, things in view, or a phrase being said.", false
	}
}

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

func (server *Server) submitter(request *http.Request) (string, bool) {
	if address, ok := server.caller(request); ok {
		return address, true
	}
	if server.operatorToken == "" {
		return "", false
	}
	offered := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(offered), []byte(server.operatorToken)) == 1 {
		return operatorSubmitter, true
	}
	return "", false
}

const (
	submissionsPerDay = 10
	operatorSubmitter = "scry:operator"
)

var streamCategories = []string{"Traffic", "Parking", "Queues", "Operations", "Footfall", "Mobility", "Weather", "Creators"}

type SubmissionQuota interface {
	SubmittedSince(context.Context, string, time.Duration) (int, error)
}

type StreamStatuses interface {
	StreamStatus(context.Context, string) (domain.StreamStatus, error)
}

// A talking stream is not a road. Filed under Traffic by default, a streamer
// showed up in the wrong list, counted in vehicles.
func categoryFor(submission domain.StreamSubmission) (string, bool) {
	category := submission.Category
	if category == "" {
		category = "Traffic"
		if submission.Claim.Kind == "phrase" {
			category = "Creators"
		}
	}
	return category, slices.Contains(streamCategories, category)
}

func (server *Server) getStream(writer http.ResponseWriter, request *http.Request) {
	streams, ok := server.store.(StreamStatuses)
	if !ok {
		writeError(writer, http.StatusNotImplemented, "streams_unavailable", "Looking up a stream needs a database.")
		return
	}
	status, err := streams.StreamStatus(request.Context(), request.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "stream_not_found", "Stream not found.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "stream_store_unavailable", "Streams are temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, status)
}
