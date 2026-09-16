package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"
)

// How long a running count is worth showing. Observers send one every few
// seconds, so anything older than this came from an observer that has stopped.
const progressFresh = 30 * time.Second

const maxProgressBytes = 1024

type liveCount struct {
	ObserverID string
	Count      int64
	Elapsed    float64
	At         time.Time
}

// Running counts while a window is open, held in memory only. They are worth
// nothing once the window closes, the report that settles the market is stored
// on its own, and a write per observer every few seconds is not worth a table.
type progressBoard struct {
	mu     sync.Mutex
	counts map[string]map[string]liveCount
}

func newProgressBoard() *progressBoard {
	return &progressBoard{counts: map[string]map[string]liveCount{}}
}

func (board *progressBoard) record(market string, entry liveCount) {
	board.mu.Lock()
	defer board.mu.Unlock()

	if board.counts[market] == nil {
		board.counts[market] = map[string]liveCount{}
	}
	board.counts[market][entry.ObserverID] = entry
	board.forget()
}

// forget drops what has gone quiet, so a server up for weeks is not still
// holding last Tuesday's windows.
func (board *progressBoard) forget() {
	for market, observers := range board.counts {
		for id, entry := range observers {
			if time.Since(entry.At) > progressFresh {
				delete(observers, id)
			}
		}
		if len(observers) == 0 {
			delete(board.counts, market)
		}
	}
}

func (board *progressBoard) of(market string) []liveCount {
	board.mu.Lock()
	defer board.mu.Unlock()

	var out []liveCount
	for _, entry := range board.counts[market] {
		if time.Since(entry.At) <= progressFresh {
			out = append(out, entry)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ObserverID < out[j].ObserverID })
	return out
}

func perMinute(count int64, elapsed float64) float64 {
	if elapsed <= 0 {
		return 0
	}
	return math.Round(float64(count)*60/elapsed*10) / 10
}

// A running count is signed exactly like a report. It settles nothing, but a
// number on the market's page that anyone could post is a number anyone could
// use to move the odds.
func (server *Server) postProgress(writer http.ResponseWriter, request *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, maxProgressBytes))
	if err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_progress", "Progress body could not be read.")
		return
	}

	var input struct {
		ObserverID string  `json:"observerId"`
		Role       string  `json:"role"`
		Count      int64   `json:"count"`
		Elapsed    float64 `json:"elapsedSeconds"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_progress", "Progress body is not valid JSON.")
		return
	}

	market := request.PathValue("id")
	if !server.signedBy(input.ObserverID, market, body, request.Header.Get("X-Scry-Signature")) {
		writeError(writer, http.StatusUnauthorized, "progress_not_signed",
			"A running count has to be signed by the key registered for its observer.")
		return
	}
	if input.Count < 0 || input.Elapsed < 0 {
		writeError(writer, http.StatusUnprocessableEntity, "invalid_progress",
			"A running count cannot be negative.")
		return
	}

	server.progress.record(market, liveCount{
		ObserverID: input.ObserverID,
		Count:      input.Count,
		Elapsed:    input.Elapsed,
		At:         time.Now(),
	})
	writer.WriteHeader(http.StatusNoContent)
}
