package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

// Observers are independent processes on the far side of a network, so treat
// every field as hostile until checked.
const (
	maxReportBytes = 1 << 20
	maxCountRows   = 3600
)

var (
	observerRoles  = []string{"edge", "primary_vision", "verification"}
	invalidReasons = []string{
		"insufficient_observers", "observer_divergence", "uptime_below_minimum",
		"timestamp_drift", "visibility_below_minimum", "stream_frozen",
		"evidence_unavailable", "manipulation_suspected", "outcome_unresolved",
		"observer_set_invalid", "scene_changed",
	}
)

// observationStore is satisfied by the Postgres store. The in-memory store is
// read-only, so a deployment without a database refuses reports rather than
// pretending to accept them.
type observationStore interface {
	SaveReport(context.Context, domain.ObserverReport) error
	SaveCounts(context.Context, string, string, []domain.CountSample) error
}

func (server *Server) postObservation(writer http.ResponseWriter, request *http.Request) {
	ingester, ok := server.store.(observationStore)
	if !ok {
		writeError(writer, http.StatusServiceUnavailable, "observations_unsupported",
			"This deployment cannot accept observer reports.")
		return
	}

	request.Body = http.MaxBytesReader(writer, request.Body, maxReportBytes)

	var report domain.ObserverReport
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&report); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_report", "Report body is not valid JSON.")
		return
	}
	report.MarketID = request.PathValue("id")

	if problem := validate(&report); problem != "" {
		writeError(writer, http.StatusUnprocessableEntity, "invalid_report", problem)
		return
	}

	// A count taken after the camera moved is not the count this market asked
	// for, however confidently the observers agree on it.
	if scenes, ok := server.store.(QualifiedScenes); ok {
		if qualified, err := scenes.SceneForMarket(request.Context(), report.MarketID); err == nil {
			if sceneChanged(qualified, report.SceneHash) {
				report.InvalidReasons = append(report.InvalidReasons, "scene_changed")
				server.log.Warn("report counted a different scene",
					"market", report.MarketID, "observer", report.ObserverID,
					"drift", sceneDrift(qualified, report.SceneHash))
			}
		}
	}

	err := ingester.SaveReport(request.Context(), report)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(writer, http.StatusNotFound, "market_not_found", "Market not found.")
		return
	case errors.Is(err, store.ErrNotObserving):
		writeError(writer, http.StatusConflict, "market_not_observing",
			"The observation window for this market is not open.")
		return
	case err != nil:
		writeError(writer, http.StatusInternalServerError, "report_not_saved", "Report could not be saved.")
		return
	}

	// The report settles the market; the per-interval counts are supporting
	// evidence, so losing them is reported but not fatal.
	if len(report.Counts) > 0 {
		if err := ingester.SaveCounts(request.Context(), report.MarketID, report.ObserverID, report.Counts); err != nil {
			writeJSON(writer, http.StatusAccepted, map[string]string{
				"status":  "accepted",
				"warning": "counts were not stored",
			})
			return
		}
	}

	writeJSON(writer, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func validate(r *domain.ObserverReport) string {
	if r.ObserverID == "" {
		return "observerId is required."
	}
	if !slices.Contains(observerRoles, r.Role) {
		return fmt.Sprintf("role must be one of %v.", observerRoles)
	}
	if r.ObservedValue < 0 {
		return "observedValue cannot be negative."
	}
	if r.ModelVersion == "" {
		return "modelVersion is required so a result can be traced to what produced it."
	}
	for _, field := range []struct {
		name  string
		value float64
	}{
		{"confidence", r.Confidence},
		{"uptime", r.Uptime},
		{"averageVisibility", r.Visibility},
	} {
		if field.value < 0 || field.value > 1 {
			return fmt.Sprintf("%s must be between 0 and 1.", field.name)
		}
	}
	if r.DriftMS < 0 || r.FrozenSeconds < 0 {
		return "drift and frozen duration cannot be negative."
	}
	for _, reason := range r.InvalidReasons {
		if !slices.Contains(invalidReasons, reason) {
			return fmt.Sprintf("unknown invalid reason %q.", reason)
		}
	}
	if len(r.Counts) > maxCountRows {
		return fmt.Sprintf("at most %d count samples per report.", maxCountRows)
	}
	for _, c := range r.Counts {
		if _, err := time.Parse(time.RFC3339Nano, c.ObservedAt); err != nil {
			return fmt.Sprintf("count timestamp %q is not RFC3339.", c.ObservedAt)
		}
		if c.Count < 0 || c.IntervalSeconds <= 0 {
			return "count samples need a non-negative count and a positive interval."
		}
		if c.Quality < 0 || c.Quality > 1 {
			return "streamQuality must be between 0 and 1."
		}
	}
	if r.InvalidReasons == nil {
		r.InvalidReasons = []string{}
	}
	return ""
}
