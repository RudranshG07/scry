package httpapi_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/httpapi"
)

// Produced by scry_vision.signing with private key 1; tests/test_signing.py
// pins the same pair, so a change to the signed message breaks both languages.
const (
	pythonBody      = `{"observerId": "vision-01", "role": "primary_vision", "observedValue": 42, "confidence": 0.9, "modelVersion": "yolov8s-bytetrack/1.0-primary", "uptime": 0.97, "maximumTimestampDriftMs": 0.0, "averageVisibility": 1.0, "longestFrozenSeconds": 0.0, "invalidReasons": []}`
	pythonSignature = "0x1631e2133f984a9a20f1f9b5b6e4d6c18334945292b974612d12029e23d0519e35d78a77316a16f3ada5eaeaea468cee1c8a198ace894b734ddf6e9045fac15e01"
)

type reportStore struct {
	*emptyStore
	saved []domain.ObserverReport
}

func (s *reportStore) SaveReport(_ context.Context, report domain.ObserverReport) error {
	s.saved = append(s.saved, report)
	return nil
}

func (s *reportStore) SaveCounts(context.Context, string, string, []domain.CountSample) error {
	return nil
}

func observerKey(b byte) *secp256k1.PrivateKey {
	var raw [32]byte
	raw[31] = b
	return secp256k1.PrivKeyFromBytes(raw[:])
}

func addressOf(key *secp256k1.PrivateKey) string {
	hash := sha3.NewLegacyKeccak256()
	hash.Write(key.PubKey().SerializeUncompressed()[1:])
	return fmt.Sprintf("0x%x", hash.Sum(nil)[12:])
}

func sign(key *secp256k1.PrivateKey, market string, body string) string {
	message := fmt.Sprintf("scry-observation:%s:%x", market, sha256.Sum256([]byte(body)))
	hash := sha3.NewLegacyKeccak256()
	fmt.Fprintf(hash, "\x19Ethereum Signed Message:\n%d%s", len(message), message)
	compact := ecdsa.SignCompact(key, hash.Sum(nil), false)
	return fmt.Sprintf("0x%x", append(compact[1:], compact[0]))
}

func report(t *testing.T, market, body, signature string) (*httptest.ResponseRecorder, *reportStore) {
	t.Helper()
	t.Setenv("SCRY_OBSERVERS", "vision-01="+addressOf(observerKey(1))+",verify-01="+addressOf(observerKey(2)))
	reports := &reportStore{emptyStore: newEmptyStore()}
	request := httptest.NewRequest(http.MethodPost, "/v1/markets/"+market+"/observations", bytes.NewBufferString(body))
	if signature != "" {
		request.Header.Set("X-Scry-Signature", signature)
	}
	recorder := httptest.NewRecorder()
	httpapi.New(reports, nil, "http://127.0.0.1:3000").ServeHTTP(recorder, request)
	return recorder, reports
}

func TestAnUnsignedReportIsRefused(t *testing.T) {
	response, reports := report(t, "market-1", pythonBody, "")
	if response.Code != http.StatusUnauthorized || len(reports.saved) != 0 {
		t.Fatalf("expected 401 and nothing saved, got %d with %d saved", response.Code, len(reports.saved))
	}
}

func TestAReportSignedByItsObserverIsAccepted(t *testing.T) {
	signature := sign(observerKey(1), "market-1", pythonBody)
	response, reports := report(t, "market-1", pythonBody, signature)
	if response.Code != http.StatusAccepted || len(reports.saved) != 1 {
		t.Fatalf("expected 202 and one saved report, got %d with %d saved", response.Code, len(reports.saved))
	}
	if saved := reports.saved[0].Signature; saved == nil || *saved != signature {
		t.Fatalf("the signature was not kept with the report, got %v", saved)
	}
}

func TestTheSignatureFromThePythonObserverVerifies(t *testing.T) {
	response, reports := report(t, "market-1", pythonBody, pythonSignature)
	if response.Code != http.StatusAccepted || len(reports.saved) != 1 {
		t.Fatalf("expected 202 and one saved report, got %d with %d saved", response.Code, len(reports.saved))
	}
}

func TestOneObserverCannotReportAsTheOther(t *testing.T) {
	response, _ := report(t, "market-1", pythonBody, sign(observerKey(2), "market-1", pythonBody))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("verify-01's key reported as vision-01 and got %d", response.Code)
	}
}

func TestAnUnregisteredKeyIsRefused(t *testing.T) {
	response, _ := report(t, "market-1", pythonBody, sign(observerKey(3), "market-1", pythonBody))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}

func TestASignatureForOneMarketCannotSettleAnother(t *testing.T) {
	response, _ := report(t, "market-2", pythonBody, sign(observerKey(1), "market-1", pythonBody))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}

func TestAChangedCountDoesNotKeepItsSignature(t *testing.T) {
	signature := sign(observerKey(1), "market-1", pythonBody)
	altered := strings.Replace(pythonBody, `"observedValue": 42`, `"observedValue": 420`, 1)
	response, reports := report(t, "market-1", altered, signature)
	if response.Code != http.StatusUnauthorized || len(reports.saved) != 0 {
		t.Fatalf("expected 401 and nothing saved, got %d with %d saved", response.Code, len(reports.saved))
	}
}

func TestWithNoObserversRegisteredEveryReportIsRefused(t *testing.T) {
	t.Setenv("SCRY_OBSERVERS", "")
	reports := &reportStore{emptyStore: newEmptyStore()}
	request := httptest.NewRequest(http.MethodPost, "/v1/markets/market-1/observations", bytes.NewBufferString(pythonBody))
	request.Header.Set("X-Scry-Signature", pythonSignature)
	recorder := httptest.NewRecorder()
	httpapi.New(reports, nil, "http://127.0.0.1:3000").ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
}
