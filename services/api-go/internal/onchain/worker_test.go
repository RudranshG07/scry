package onchain

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/RudranshG07/scry/services/api-go/internal/chain"
	"github.com/RudranshG07/scry/services/api-go/internal/config"
)

// Anvil's first key, public and worthless, as in wire_test.go.
const testKey = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

const (
	testBook     = "0x2bed92b52b9bf6cdcfc0fe20ee9c7d413b6cbd19"
	testResolver = "0xe4e24a107fbbadd1d01c0f8b7da5b16bd642c94e"
	testRegistry = "0x4f51f6eb3a8e7196daec9118722cb55c73361fec"
	testOperator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
	testTxHash   = "0x48284541971ca7d505fc878f40c52c304bf3f5715a35050fdb8397551a3286c9"
)

// node answers the calls the worker makes without reading the database: the
// checks that decide whether it may transact at all, and the send that carries
// a transaction to a receipt.
type node struct {
	chainID       int64
	operatorOf    map[string]string
	wiredBook     string
	registry      string
	threshold     int64
	ruleHash      int64
	receiptStatus int64
	receiptBlock  int64
}

func addressWord(address string) string {
	return strings.Repeat("0", 24) + strings.ToLower(strings.TrimPrefix(address, "0x"))
}

func uintWord(value int64) string {
	return fmt.Sprintf("%064x", value)
}

// The first four bytes name the function; ruleHash carries a market key after
// them, so only the prefix is matched.
func prefixOf(data []byte) string {
	return hex.EncodeToString(data)[:8]
}

func (n node) serve(t *testing.T) *httptest.Server {
	t.Helper()
	operator := prefixOf(chain.OperatorCall())
	book := prefixOf(chain.BookCall())
	registry := prefixOf(chain.ObserverRegistryCall())
	threshold := prefixOf(chain.SignatureThresholdCall())
	rule := prefixOf(chain.RuleHashCall([32]byte{}))

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var envelope struct {
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(request.Body).Decode(&envelope); err != nil {
			t.Errorf("the worker sent something that is not JSON-RPC: %v", err)
			return
		}
		answer := func(result string) {
			fmt.Fprintf(writer, `{"jsonrpc":"2.0","id":1,"result":%q}`, result)
		}

		switch envelope.Method {
		case "eth_chainId":
			answer(fmt.Sprintf("0x%x", n.chainID))
		case "eth_getTransactionCount":
			answer("0x7")
		case "eth_gasPrice":
			answer("0x3b9aca00")
		case "eth_estimateGas":
			answer("0x186a0")
		case "eth_sendRawTransaction":
			answer(testTxHash)
		case "eth_getTransactionReceipt":
			// Always complete: WaitFor polls every second until a receipt names
			// a block, so an incomplete one would hang the suite, not fail it.
			fmt.Fprintf(writer, `{"jsonrpc":"2.0","id":1,"result":{"status":"0x%x","blockNumber":"0x%x"}}`,
				n.receiptStatus, n.receiptBlock)
		case "eth_call":
			var call struct {
				To   string `json:"to"`
				Data string `json:"data"`
			}
			if err := json.Unmarshal(envelope.Params[0], &call); err != nil {
				t.Errorf("eth_call: %v", err)
				return
			}
			switch strings.TrimPrefix(call.Data, "0x")[:8] {
			case operator:
				answer("0x" + addressWord(n.operatorOf[strings.ToLower(call.To)]))
			case book:
				answer("0x" + addressWord(n.wiredBook))
			case registry:
				answer("0x" + addressWord(n.registry))
			case threshold:
				answer("0x" + uintWord(n.threshold))
			case rule:
				answer("0x" + uintWord(n.ruleHash))
			default:
				t.Errorf("unexpected call %s to %s", call.Data, call.To)
			}
		default:
			t.Errorf("unexpected method %s", envelope.Method)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// healthy is a deployment that names this signer as operator on both contracts,
// wires the resolver to the book, and mines what it is sent.
func healthy() node {
	return node{
		chainID: 84532,
		operatorOf: map[string]string{
			testBook:     testOperator,
			testResolver: testOperator,
		},
		wiredBook:     testBook,
		registry:      testRegistry,
		threshold:     2,
		receiptStatus: 1,
		receiptBlock:  46950000,
	}
}

func worker(t *testing.T, n node) *Worker {
	t.Helper()
	signer, err := chain.NewSigner(testKey)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(nil, log, signer, config.Chain{
		ID:       84532,
		RPC:      n.serve(t).URL,
		Book:     testBook,
		Resolver: testResolver,
	})
}

func TestCheckAcceptsADeploymentThatNamesThisServer(t *testing.T) {
	w := worker(t, healthy())
	if err := w.Check(t.Context()); err != nil {
		t.Fatalf("a healthy deployment was refused: %v", err)
	}
	if w.threshold != 2 {
		t.Fatalf("threshold = %d, want 2", w.threshold)
	}
}

// An RPC pointed at the wrong network would settle nothing and spend gas
// finding that out, one market at a time.
func TestCheckRefusesANodeOnAnotherChain(t *testing.T) {
	n := healthy()
	n.chainID = 1
	if err := worker(t, n).Check(t.Context()); err == nil {
		t.Fatal("a node on chain 1 was accepted for chain 84532")
	}
}

func TestCheckRefusesABookThatNamesAnotherOperator(t *testing.T) {
	n := healthy()
	n.operatorOf[testBook] = "0x000000000000000000000000000000000000dead"
	err := worker(t, n).Check(t.Context())
	if err == nil {
		t.Fatal("a book this server cannot operate was accepted")
	}
	if !strings.Contains(err.Error(), "operator") {
		t.Fatalf("error does not say whose operator is wrong: %v", err)
	}
}

func TestCheckRefusesAResolverThatNamesAnotherOperator(t *testing.T) {
	n := healthy()
	n.operatorOf[testResolver] = "0x000000000000000000000000000000000000dead"
	if err := worker(t, n).Check(t.Context()); err == nil {
		t.Fatal("a resolver this server cannot operate was accepted")
	}
}

// The pair is wired once and cannot be moved. A resolver settling a different
// book would finalize results into markets holding nobody's money.
func TestCheckRefusesAResolverWiredToAnotherBook(t *testing.T) {
	n := healthy()
	n.wiredBook = "0x000000000000000000000000000000000000beef"
	err := worker(t, n).Check(t.Context())
	if err == nil {
		t.Fatal("a resolver wired to another book was accepted")
	}
	if !strings.Contains(err.Error(), "settles") {
		t.Fatalf("error does not name the mismatch: %v", err)
	}
}

// A registry reporting no threshold must not mean "anyone's signature will do".
func TestCheckNeverAcceptsAThresholdOfNobody(t *testing.T) {
	n := healthy()
	n.threshold = 0
	w := worker(t, n)
	if err := w.Check(t.Context()); err != nil {
		t.Fatal(err)
	}
	if w.threshold != 1 {
		t.Fatalf("threshold = %d, want at least 1", w.threshold)
	}
}

func TestAMarketTheBookHasNeverHeldReadsAsUnopened(t *testing.T) {
	w := worker(t, healthy())
	open, err := w.opened(t.Context(), chain.MarketKey("market-1"))
	if err != nil {
		t.Fatal(err)
	}
	if open {
		t.Fatal("a market with no rule hash was reported as already open")
	}
}

// Opening the same market twice would revert and strand the deployment, so the
// worker asks the book first.
func TestAMarketTheBookAlreadyHoldsReadsAsOpened(t *testing.T) {
	n := healthy()
	n.ruleHash = 1
	w := worker(t, n)
	open, err := w.opened(t.Context(), chain.MarketKey("market-1"))
	if err != nil {
		t.Fatal(err)
	}
	if !open {
		t.Fatal("a market the book holds was reported as missing")
	}
}

func TestSendCarriesATransactionToItsReceipt(t *testing.T) {
	w := worker(t, healthy())
	hash, block, err := w.send(t.Context(), testBook, chain.OperatorCall())
	if err != nil {
		t.Fatalf("a mined transaction was reported as failed: %v", err)
	}
	if hash != testTxHash {
		t.Fatalf("hash = %s, want %s", hash, testTxHash)
	}
	if block != 46950000 {
		t.Fatalf("block = %d, want 46950000", block)
	}
}

// A reverted transaction is mined like any other. Treating it as settled would
// mark a market resolved that the chain never resolved.
func TestSendTreatsARevertedTransactionAsAFailure(t *testing.T) {
	n := healthy()
	n.receiptStatus = 0
	_, _, err := worker(t, n).send(t.Context(), testBook, chain.OperatorCall())
	if err == nil {
		t.Fatal("a reverted transaction was accepted")
	}
	if !strings.Contains(err.Error(), "reverted") {
		t.Fatalf("error does not say it reverted: %v", err)
	}
}

// These constants are the contract enums by position. Reordering the Solidity
// would silently change which status the worker thinks a market is in, so the
// source is read back rather than trusted.
func TestTheStatusConstantsStillMatchTheContracts(t *testing.T) {
	source, err := os.ReadFile("../../../../contracts/src/ScryTypes.sol")
	if err != nil {
		t.Skip("contracts are not beside this module")
	}

	positionsIn := func(name string) map[string]int {
		pattern := regexp.MustCompile(`enum ` + name + ` \{([^}]*)\}`)
		found := pattern.FindSubmatch(source)
		if found == nil {
			t.Fatalf("no enum %s in ScryTypes.sol", name)
		}
		out := map[string]int{}
		for index, member := range strings.Split(string(found[1]), ",") {
			out[strings.TrimSpace(member)] = index
		}
		return out
	}

	market := positionsIn("MarketStatus")
	observation := positionsIn("ObservationStatus")
	for _, want := range []struct {
		name  string
		got   int
		where map[string]int
		key   string
	}{
		{"marketResolved", marketResolved, market, "Resolved"},
		{"marketInvalid", marketInvalid, market, "Invalid"},
		{"observationProposed", observationProposed, observation, "Proposed"},
		{"observationChallenged", observationChallenged, observation, "Challenged"},
		{"observationFinal", observationFinal, observation, "Final"},
		{"observationInvalid", observationInvalid, observation, "Invalid"},
	} {
		if want.got != want.where[want.key] {
			t.Errorf("%s = %d, but %s sits at %d in the contract",
				want.name, want.got, want.key, want.where[want.key])
		}
	}
}
