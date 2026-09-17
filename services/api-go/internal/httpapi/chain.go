package httpapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"github.com/RudranshG07/scry/services/api-go/internal/chain"
	"github.com/RudranshG07/scry/services/api-go/internal/config"
	"github.com/RudranshG07/scry/services/api-go/internal/domain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

type deploymentStore interface {
	RequestDeployment(context.Context, string, int64, string) (domain.Deployment, error)
}

type settlementStore interface {
	PendingSettlements(context.Context, string) ([]domain.Settlement, error)
	SettlementFor(context.Context, string, int64) (domain.Settlement, error)
	SaveAttestation(context.Context, domain.Settlement, string, string, string) error
}

func (server *Server) chain(id int64) (config.Chain, bool) {
	for _, deployment := range server.chains {
		if deployment.ID == id {
			return deployment, true
		}
	}
	return config.Chain{}, false
}

func (server *Server) getChains(writer http.ResponseWriter, _ *http.Request) {
	out := make([]map[string]any, 0, len(server.chains))
	for _, deployment := range server.chains {
		out = append(out, map[string]any{
			"chainId":  deployment.ID,
			"book":     chain.Checksum(deployment.Book),
			"resolver": chain.Checksum(deployment.Resolver),
		})
	}
	writeJSON(writer, http.StatusOK, out)
}

// Anyone may ask for a market to be deployed. What it costs is bounded by the
// markets there are, each deployed once per chain, and asking twice returns the
// deployment already under way.
func (server *Server) postDeployment(writer http.ResponseWriter, request *http.Request) {
	deployments, ok := server.store.(deploymentStore)
	if !ok {
		writeError(writer, http.StatusServiceUnavailable, "deployments_unsupported",
			"This deployment cannot put markets on chain.")
		return
	}

	var input struct {
		ChainID int64 `json:"chainId"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_deployment", "Name the chain to deploy on.")
		return
	}
	if _, ok := server.chain(input.ChainID); !ok {
		writeError(writer, http.StatusUnprocessableEntity, "chain_unsupported", "Scry does not settle on that chain.")
		return
	}

	account, _ := server.caller(request)
	deployment, err := deployments.RequestDeployment(request.Context(), request.PathValue("id"), input.ChainID, account)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(writer, http.StatusNotFound, "market_not_found", "Market not found.")
		return
	case errors.Is(err, store.ErrClosed):
		writeError(writer, http.StatusConflict, "market_closed", "This market is no longer taking positions.")
		return
	case err != nil:
		server.log.Error("deployment request failed", "market", request.PathValue("id"), "error", err)
		writeError(writer, http.StatusInternalServerError, "deployment_unavailable", "The market could not be deployed.")
		return
	}
	writeJSON(writer, http.StatusAccepted, deployment)
}

func (server *Server) getSettlements(writer http.ResponseWriter, request *http.Request) {
	settlements, ok := server.store.(settlementStore)
	if !ok {
		writeError(writer, http.StatusServiceUnavailable, "settlements_unsupported", "This deployment settles nothing on chain.")
		return
	}
	observer := request.PathValue("observer")
	if _, known := server.observers[observer]; !known {
		writeError(writer, http.StatusNotFound, "observer_not_found", "No observer is registered under that id.")
		return
	}

	pending, err := settlements.PendingSettlements(request.Context(), observer)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "settlements_unavailable", "Settlements are temporarily unavailable.")
		return
	}
	out := make([]domain.Settlement, 0, len(pending))
	for _, settlement := range pending {
		if err := server.seal(&settlement); err != nil {
			server.log.Warn("settlement cannot be signed", "market", settlement.MarketID, "chain", settlement.ChainID, "error", err)
			continue
		}
		out = append(out, settlement)
	}
	writeJSON(writer, http.StatusOK, out)
}

// An attestation carries its own proof: it has to recover to the address
// registered for the observer, over the digest of the result as it stands now.
// A signature over anything else, or by anyone else, is refused here rather
// than by the resolver after gas has been spent on it.
func (server *Server) postAttestation(writer http.ResponseWriter, request *http.Request) {
	settlements, ok := server.store.(settlementStore)
	if !ok {
		writeError(writer, http.StatusServiceUnavailable, "settlements_unsupported", "This deployment settles nothing on chain.")
		return
	}

	var input domain.Attestation
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_attestation", "Attestation body is not valid JSON.")
		return
	}
	address, known := server.observers[input.ObserverID]
	if !known {
		writeError(writer, http.StatusUnauthorized, "attestation_not_signed", "No observer is registered under that id.")
		return
	}

	settlement, err := settlements.SettlementFor(request.Context(), request.PathValue("id"), input.ChainID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusConflict, "nothing_to_attest", "No result on that chain is waiting for signatures.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "settlements_unavailable", "Settlements are temporarily unavailable.")
		return
	}
	if err := server.seal(&settlement); err != nil {
		writeError(writer, http.StatusUnprocessableEntity, "chain_unsupported", "Scry does not settle on that chain.")
		return
	}

	signature, err := hex.DecodeString(strings.TrimPrefix(input.Signature, "0x"))
	if err != nil || len(signature) != 65 {
		writeError(writer, http.StatusUnprocessableEntity, "invalid_attestation", "A signature is 65 bytes of hex.")
		return
	}
	if signature[64] < 27 {
		signature[64] += 27
	}
	digest, err := chain.Bytes32(settlement.Digest)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "settlements_unavailable", "Settlements are temporarily unavailable.")
		return
	}
	signer, err := chain.SignerOf(digest, signature)
	if err != nil || !strings.EqualFold(signer, address) {
		writeError(writer, http.StatusUnauthorized, "attestation_not_signed",
			"The signature is not this observer's over this result.")
		return
	}

	if err := settlements.SaveAttestation(request.Context(), settlement, input.ObserverID, signer,
		"0x"+hex.EncodeToString(signature)); err != nil {
		writeError(writer, http.StatusInternalServerError, "attestation_not_saved", "Attestation could not be saved.")
		return
	}
	writeJSON(writer, http.StatusAccepted, map[string]string{"status": "accepted", "digest": settlement.Digest})
}

func (server *Server) seal(settlement *domain.Settlement) error {
	deployment, ok := server.chain(settlement.ChainID)
	if !ok {
		return fmt.Errorf("chain %d is not configured", settlement.ChainID)
	}
	result, err := chain.NewResult(settlement.MarketID, settlement.ObservedValue, settlement.WinningOutcomeID,
		settlement.EvidenceRoot, settlement.RuleHash, settlement.ObservedAt)
	if err != nil {
		return err
	}
	digest, err := chain.ResultDigest(big.NewInt(settlement.ChainID), deployment.Resolver, result)
	if err != nil {
		return err
	}
	settlement.Resolver = chain.Checksum(deployment.Resolver)
	settlement.Digest = "0x" + hex.EncodeToString(digest[:])
	return nil
}
