package chain

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"math/big"
	"os/exec"
	"strings"
	"testing"
)

func foundryCalldata(t *testing.T, args ...string) string {
	t.Helper()
	if _, err := exec.LookPath("cast"); err != nil {
		t.Skip("foundry's cast is not installed")
	}
	out, err := exec.Command("cast", append([]string{"calldata"}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("cast calldata: %v: %s", err, out)
	}
	return strings.TrimSpace(string(out))
}

func outcomeID(t *testing.T, text string) [32]byte {
	t.Helper()
	id, err := Text32(text)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestCreateMarketCalldataMatchesFoundry(t *testing.T) {
	rule := Rule{
		MarketID:            MarketKey("stream-live-traffic-camera-feed-car-ac8e569c-1789422072"),
		StreamID:            MarketKey("stream-live-traffic-camera-feed-car-ac8e569c"),
		RuleHash:            MarketKey("rule"),
		OpensAt:             1789421592,
		LocksAt:             1789422072,
		ObservationStartsAt: 1789422072,
		ObservationEndsAt:   1789422312,
		MinimumUptimeBps:    9500,
		MaximumDriftMs:      2000,
		MaximumDivergence:   20,
	}
	yes, no := outcomeID(t, "yes"), outcomeID(t, "no")
	// Longer than one word, so the label's padding into a second word is covered.
	outcomes := []Outcome{
		{ID: yes, Label: "Yes above one hundred and fifty things", Minimum: big.NewInt(151), HasMinimum: true},
		{ID: no, Label: "No", Maximum: big.NewInt(150), HasMaximum: true},
	}

	got := "0x" + hex.EncodeToString(CreateMarketCall(rule, outcomes, big.NewInt(25_000_000)))
	want := foundryCalldata(t,
		"createMarket((bytes32,bytes32,bytes32,uint64,uint64,uint64,uint64,uint16,uint32,uint64),(bytes32,string,uint256,uint256,bool,bool)[],uint256)",
		fmt.Sprintf("(0x%x,0x%x,0x%x,1789421592,1789422072,1789422072,1789422312,9500,2000,20)",
			rule.MarketID, rule.StreamID, rule.RuleHash),
		fmt.Sprintf(`[(0x%x,"Yes above one hundred and fifty things",151,0,true,false),(0x%x,"No",0,150,false,true)]`, yes, no),
		"25000000",
	)
	if got != want {
		t.Fatalf("createMarket calldata differs from foundry\n got %s\nwant %s", got, want)
	}
}

func TestProposeCalldataMatchesFoundry(t *testing.T) {
	market := "0x1111111111111111111111111111111111111111"
	result := Result{
		MarketID:         MarketKey("market-1"),
		ObservedValue:    big.NewInt(164),
		WinningOutcomeID: outcomeID(t, "yes"),
		EvidenceRoot:     MarketKey("evidence"),
		RuleHash:         MarketKey("rule"),
		ObservedAt:       1789422312,
	}
	first, second := bytes.Repeat([]byte{0xaa}, 65), bytes.Repeat([]byte{0xbb}, 65)

	data, err := ProposeCall(market, result, [][]byte{first, second})
	if err != nil {
		t.Fatal(err)
	}
	want := foundryCalldata(t,
		"propose(address,(bytes32,uint256,bytes32,bytes32,bytes32,uint64,bool),bytes[])",
		market,
		fmt.Sprintf("(0x%x,164,0x%x,0x%x,0x%x,1789422312,false)",
			result.MarketID, result.WinningOutcomeID, result.EvidenceRoot, result.RuleHash),
		fmt.Sprintf("[0x%x,0x%x]", first, second),
	)
	if got := "0x" + hex.EncodeToString(data); got != want {
		t.Fatalf("propose calldata differs from foundry\n got %s\nwant %s", got, want)
	}
}

func TestSettlementCallsMatchFoundry(t *testing.T) {
	market := "0x2222222222222222222222222222222222222222"
	reason := outcomeID(t, "observers disagreed")

	finalize, err := FinalizeCall(market)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := "0x"+hex.EncodeToString(finalize), foundryCalldata(t, "finalize(address)", market); got != want {
		t.Fatalf("finalize got %s want %s", got, want)
	}

	void, err := VoidCall(market, reason)
	if err != nil {
		t.Fatal(err)
	}
	want := foundryCalldata(t, "invalidate(address,bytes32)", market, fmt.Sprintf("0x%x", reason))
	if got := "0x" + hex.EncodeToString(void); got != want {
		t.Fatalf("invalidate got %s want %s", got, want)
	}
}

func TestOutcomeIDsAreLeftAlignedLikeSolidityLiterals(t *testing.T) {
	id := outcomeID(t, "yes")
	if !bytes.Equal(id[:3], []byte("yes")) || id[31] != 0 {
		t.Fatalf("outcome id %x is not a left-aligned literal", id)
	}
	if _, err := Text32(strings.Repeat("x", 33)); err == nil {
		t.Fatal("an id longer than bytes32 was accepted")
	}
}

func TestADigestNamesItsChainAndResolver(t *testing.T) {
	result := Result{MarketID: MarketKey("m"), ObservedValue: big.NewInt(1), ObservedAt: 1}
	base, err := ResultDigest(big.NewInt(8453), "0x3333333333333333333333333333333333333333", result)
	if err != nil {
		t.Fatal(err)
	}
	polygon, _ := ResultDigest(big.NewInt(137), "0x3333333333333333333333333333333333333333", result)
	other, _ := ResultDigest(big.NewInt(8453), "0x4444444444444444444444444444444444444444", result)
	if base == polygon || base == other {
		t.Fatal("a signature over one deployment would verify on another")
	}
}

func TestASignedDigestNamesItsSigner(t *testing.T) {
	signer, err := NewSigner("0x" + strings.Repeat("00", 31) + "01")
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewResult("market-1", 164, "yes", "", "0x"+strings.Repeat("ab", 32), 1789422312)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := ResultDigest(big.NewInt(84532), "0x3333333333333333333333333333333333333333", result)
	if err != nil {
		t.Fatal(err)
	}

	signature := signer.SignDigest(digest)
	if v := signature[64]; v != 27 && v != 28 {
		t.Fatalf("v = %d, the resolver's ecrecover wants 27 or 28", v)
	}
	got, err := SignerOf(digest, signature)
	if err != nil {
		t.Fatal(err)
	}
	if got != "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf" {
		t.Fatalf("recovered %s", got)
	}

	// The same signature reshaped with s mirrored into the upper half recovers
	// the same key, so the resolver refuses it, and so must this.
	order, _ := new(big.Int).SetString("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16)
	twin := append([]byte(nil), signature...)
	new(big.Int).Sub(order, new(big.Int).SetBytes(signature[32:64])).FillBytes(twin[32:64])
	twin[64] = 55 - signature[64]
	if _, err := SignerOf(digest, twin); err == nil {
		t.Fatal("the high-s twin of a signature was accepted")
	}
}

func TestAResultNeedsARuleHash(t *testing.T) {
	if _, err := NewResult("market-1", 1, "yes", "", "not-a-hash", 1); err == nil {
		t.Fatal("a result without a rule hash was built")
	}
	if _, err := NewResult("market-1", 1, "yes", "", "0x"+strings.Repeat("ab", 32), 0); err == nil {
		t.Fatal("a result without a time was built")
	}
}

// Read back from ObservationResolver.digest on a local deployment at chain 31337.
// services/vision/tests/test_attest.py pins the same value for the observers.
func TestTheDigestIsTheOneTheResolverComputes(t *testing.T) {
	result, err := NewResult("market-1", 164, "yes", "", "0x"+strings.Repeat("ab", 32), 1789422312)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := ResultDigest(big.NewInt(31337), "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0", result)
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(digest[:]); got != "c523333bb075065df99e3e7ba40aa44c6da5fc216a63647aaf334e28de5a27b6" {
		t.Fatalf("digest %s is not the one the resolver computes", got)
	}
}
