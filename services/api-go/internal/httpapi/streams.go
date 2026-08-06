package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

// Inspections is the part of the store re-qualification needs.
type Inspections interface {
	PendingQualification(context.Context, time.Duration) ([]domain.StreamSource, error)
	RecordQualification(context.Context, string, domain.Qualification) error
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
