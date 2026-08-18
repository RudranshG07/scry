package chain

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"strings"
	"testing"
	"time"
)

// Proves the hand-rolled RLP, EIP-155 and secp256k1 against a real node: anvil
// recovers the sender itself, so a wrong byte anywhere shows up as a rejected
// transaction or a stranger's nonce rather than as a passing test.
func TestSignedTransactionIsAccepted(t *testing.T) {
	url := os.Getenv("SCRY_RPC_URL")
	if url == "" {
		t.Skip("no SCRY_RPC_URL")
	}
	registry := os.Getenv("SCRY_REGISTRY")
	if registry == "" {
		t.Skip("no SCRY_REGISTRY")
	}

	const anvilFirstKey = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
	const anvilFirstAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"

	signer, err := NewSigner(anvilFirstKey)
	if err != nil {
		t.Fatal(err)
	}
	if signer.Address != anvilFirstAddress {
		t.Fatalf("address = %s, want %s", signer.Address, anvilFirstAddress)
	}

	ctx := context.Background()
	client := New(url)

	// setObserver(address,bool) on a fresh address, then read it back.
	subject := fmt.Sprintf("0x%040x", time.Now().UnixNano())
	raw, _ := unhex(subject)
	data := selector("setObserver(address,bool)")
	data = append(data, word(raw)...)
	data = append(data, word([]byte{1})...)

	hash, err := signer.Submit(ctx, client, registry, data)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	t.Logf("tx %s", hash)

	receipt, err := client.WaitFor(ctx, hash)
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if receipt.Status != 1 {
		t.Fatalf("transaction reverted in block %d", receipt.BlockNumber)
	}

	answer, err := client.Call(ctx, registry, append(selector("isObserver(address)"), word(raw)...))
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if !strings.HasSuffix(hex.EncodeToString(answer), "01") {
		t.Fatalf("isObserver = %s, want true", hex.EncodeToString(answer))
	}

	// And the chain agrees the sender was us: the nonce moved.
	nonce, err := client.NonceAt(ctx, signer.Address)
	if err != nil {
		t.Fatal(err)
	}
	if nonce == 0 {
		t.Fatal("nonce did not move; the node credited someone else")
	}
	_ = big.NewInt(0)
}
