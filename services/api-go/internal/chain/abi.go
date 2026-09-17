package chain

import (
	"fmt"
	"math/big"
	"strings"
)

type Rule struct {
	MarketID            [32]byte
	StreamID            [32]byte
	RuleHash            [32]byte
	OpensAt             uint64
	LocksAt             uint64
	ObservationStartsAt uint64
	ObservationEndsAt   uint64
	MinimumUptimeBps    uint16
	MaximumDriftMs      uint32
	MaximumDivergence   uint64
}

type Outcome struct {
	ID         [32]byte
	Label      string
	Minimum    *big.Int
	Maximum    *big.Int
	HasMinimum bool
	HasMaximum bool
}

type Result struct {
	MarketID         [32]byte
	ObservedValue    *big.Int
	WinningOutcomeID [32]byte
	EvidenceRoot     [32]byte
	RuleHash         [32]byte
	ObservedAt       uint64
}

var (
	domainType = keccak([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	resultType = keccak([]byte("ObservationResult(bytes32 marketId,uint256 observedValue,bytes32 winningOutcomeId,bytes32 evidenceRoot,bytes32 ruleHash,uint64 observedAt)"))
)

// Text32 is how Solidity holds a short string literal in bytes32: left-aligned,
// which is how the contracts name outcomes ("yes", "no") and how the frontend
// encodes them when it deposits.
func Text32(text string) ([32]byte, error) {
	var out [32]byte
	if len(text) > 32 {
		return out, fmt.Errorf("%q is longer than 32 bytes", text)
	}
	copy(out[:], text)
	return out, nil
}

func TextOf(raw [32]byte) string { return strings.TrimRight(string(raw[:]), "\x00") }

// NewResult is a result as the resolver hashes it, from the values the engine
// stores for a market.
func NewResult(marketID string, value int64, winner, evidenceRoot, ruleHash string, observedAt int64) (Result, error) {
	if value < 0 || observedAt <= 0 {
		return Result{}, fmt.Errorf("result for %s needs a count and a time", marketID)
	}
	outcome, err := Text32(winner)
	if err != nil {
		return Result{}, err
	}
	rule, err := Bytes32(ruleHash)
	if err != nil {
		return Result{}, fmt.Errorf("rule hash: %w", err)
	}
	var root [32]byte
	if evidenceRoot != "" {
		if root, err = Bytes32(evidenceRoot); err != nil {
			return Result{}, fmt.Errorf("evidence root: %w", err)
		}
	}
	return Result{
		MarketID:         MarketKey(marketID),
		ObservedValue:    big.NewInt(value),
		WinningOutcomeID: outcome,
		EvidenceRoot:     root,
		RuleHash:         rule,
		ObservedAt:       uint64(observedAt),
	}, nil
}

func CreateMarketCall(rule Rule, outcomes []Outcome, sponsorReward *big.Int) []byte {
	args := concat(
		rule.MarketID[:], rule.StreamID[:], rule.RuleHash[:],
		wordOfUint(rule.OpensAt), wordOfUint(rule.LocksAt),
		wordOfUint(rule.ObservationStartsAt), wordOfUint(rule.ObservationEndsAt),
		wordOfUint(uint64(rule.MinimumUptimeBps)), wordOfUint(uint64(rule.MaximumDriftMs)),
		wordOfUint(rule.MaximumDivergence),
		wordOfUint(12*32),
		wordOfInt(orZero(sponsorReward)),
	)
	elements := make([][]byte, len(outcomes))
	for i, o := range outcomes {
		label := []byte(o.Label)
		elements[i] = concat(
			o.ID[:], wordOfUint(6*32), wordOfInt(orZero(o.Minimum)), wordOfInt(orZero(o.Maximum)),
			wordOfBool(o.HasMinimum), wordOfBool(o.HasMaximum),
			wordOfUint(uint64(len(label))), padRight(label),
		)
	}
	args = append(args, dynamicArray(elements)...)
	return append(selector("createMarket((bytes32,bytes32,bytes32,uint64,uint64,uint64,uint64,uint16,uint32,uint64),(bytes32,string,uint256,uint256,bool,bool)[],uint256)"), args...)
}

// Every call names its market by id. One book holds them all, so there is no
// per-market address to look up and nothing to get wrong about which contract a
// result is being carried to.
func ProposeCall(marketID [32]byte, result Result, signatures [][]byte) []byte {
	elements := make([][]byte, len(signatures))
	for i, signature := range signatures {
		elements[i] = concat(wordOfUint(uint64(len(signature))), padRight(signature))
	}
	args := concat(
		marketID[:],
		result.MarketID[:], wordOfInt(orZero(result.ObservedValue)), result.WinningOutcomeID[:],
		result.EvidenceRoot[:], result.RuleHash[:], wordOfUint(result.ObservedAt), wordOfBool(false),
		wordOfUint(9*32),
	)
	args = append(args, dynamicArray(elements)...)
	return append(selector("propose(bytes32,(bytes32,uint256,bytes32,bytes32,bytes32,uint64,bool),bytes[])"), args...)
}

func FinalizeCall(marketID [32]byte) []byte {
	return append(selector("finalize(bytes32)"), marketID[:]...)
}

func VoidCall(marketID, reason [32]byte) []byte {
	return concat(selector("invalidate(bytes32,bytes32)"), marketID[:], reason[:])
}

func ChallengeEndsAtCall(marketID [32]byte) []byte {
	return append(selector("challengeEndsAt(bytes32)"), marketID[:]...)
}

func ObservationStatusCall(marketID [32]byte) []byte {
	return append(selector("observationStatus(bytes32)"), marketID[:]...)
}

func StatusCall(marketID [32]byte) []byte {
	return append(selector("status(bytes32)"), marketID[:]...)
}

func TotalPoolCall(marketID [32]byte) []byte {
	return append(selector("totalPool(bytes32)"), marketID[:]...)
}

// RuleHashCall says whether the book holds this market at all: a market nobody
// has opened has no rule.
func RuleHashCall(marketID [32]byte) []byte {
	return append(selector("ruleHash(bytes32)"), marketID[:]...)
}

func PoolForCall(marketID, outcomeID [32]byte) []byte {
	return concat(selector("poolFor(bytes32,bytes32)"), marketID[:], outcomeID[:])
}

func OperatorCall() []byte           { return selector("operator()") }
func ObserverRegistryCall() []byte   { return selector("observerRegistry()") }
func SignatureThresholdCall() []byte { return selector("signatureThreshold()") }
func BookCall() []byte               { return selector("book()") }

func EventTopic(signature string) string { return "0x" + hexOf(keccak([]byte(signature))) }

func Uint(raw []byte) (*big.Int, error) {
	if len(raw) < 32 {
		return nil, fmt.Errorf("want a 32 byte word, got %d bytes", len(raw))
	}
	return new(big.Int).SetBytes(raw[:32]), nil
}

// ResultDigest is the EIP-712 hash each observer signs, bound to one chain and
// one resolver so a testnet reading cannot settle a mainnet market.
func ResultDigest(chainID *big.Int, resolver string, result Result) ([32]byte, error) {
	var out [32]byte
	verifying, err := wordOfAddress(resolver)
	if err != nil {
		return out, err
	}
	domain := keccak(domainType, keccak([]byte("Scry")), keccak([]byte("1")), wordOfInt(chainID), verifying)
	structHash := keccak(resultType, result.MarketID[:], wordOfInt(orZero(result.ObservedValue)),
		result.WinningOutcomeID[:], result.EvidenceRoot[:], result.RuleHash[:], wordOfUint(result.ObservedAt))
	copy(out[:], keccak([]byte{0x19, 0x01}, domain, structHash))
	return out, nil
}

func dynamicArray(elements [][]byte) []byte {
	out := wordOfUint(uint64(len(elements)))
	offset := uint64(len(elements) * 32)
	for _, element := range elements {
		out = append(out, wordOfUint(offset)...)
		offset += uint64(len(element))
	}
	for _, element := range elements {
		out = append(out, element...)
	}
	return out
}

func concat(parts ...[]byte) []byte {
	var out []byte
	for _, part := range parts {
		out = append(out, part...)
	}
	return out
}

func wordOfUint(value uint64) []byte { return wordOfInt(new(big.Int).SetUint64(value)) }

func wordOfBool(value bool) []byte {
	if value {
		return word([]byte{1})
	}
	return word(nil)
}

func wordOfAddress(address string) ([]byte, error) {
	raw, err := unhex(address)
	if err != nil || len(raw) != 20 {
		return nil, fmt.Errorf("not an address: %q", address)
	}
	return word(raw), nil
}

func padRight(raw []byte) []byte {
	padded := make([]byte, (len(raw)+31)/32*32)
	copy(padded, raw)
	return padded
}

func orZero(value *big.Int) *big.Int {
	if value == nil {
		return new(big.Int)
	}
	return value
}
