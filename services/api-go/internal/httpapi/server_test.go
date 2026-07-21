package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/httpapi"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

func server() http.Handler {
	return httpapi.New(store.NewMemory(), nil, "http://127.0.0.1:3000")
}

func request(t *testing.T, method string, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	server().ServeHTTP(recorder, httptest.NewRequest(method, path, bytes.NewReader(body)))
	return recorder
}

func TestHealth(t *testing.T) {
	response := request(t, http.MethodGet, "/healthz", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected health status 200, got %d", response.Code)
	}
}

func TestMarketsStartAsAnEmptyArray(t *testing.T) {
	response := request(t, http.MethodGet, "/v1/markets", nil)
	var markets []domain.Market
	if err := json.NewDecoder(response.Body).Decode(&markets); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || markets == nil || len(markets) != 0 {
		t.Fatalf("expected an empty market array, got status %d and %#v", response.Code, markets)
	}
}

func TestUnknownMarketReturnsNotFound(t *testing.T) {
	response := request(t, http.MethodGet, "/v1/markets/missing", nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", response.Code)
	}
}

func TestPortfolioRequiresAnEVMAddress(t *testing.T) {
	response := request(t, http.MethodGet, "/v1/portfolio/not-an-address", nil)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", response.Code)
	}
}

func TestMessageRoundTrip(t *testing.T) {
	handler := server()
	created := httptest.NewRecorder()
	handler.ServeHTTP(created, httptest.NewRequest(http.MethodPost, "/v1/markets/market-1/messages", bytes.NewBufferString(`{"author":"Rudy","body":"Traffic is accelerating."}`)))
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", created.Code)
	}
	listed := httptest.NewRecorder()
	handler.ServeHTTP(listed, httptest.NewRequest(http.MethodGet, "/v1/markets/market-1/messages", nil))
	var messages []domain.RoomMessage
	if err := json.NewDecoder(listed.Body).Decode(&messages); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Author != "Rudy" {
		t.Fatalf("expected the created message, got %#v", messages)
	}
}

func TestPlaybackFailsClosedWithoutAnIssuer(t *testing.T) {
	response := request(t, http.MethodGet, "/v1/streams/stream-1/playback-token", nil)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", response.Code)
	}
}
