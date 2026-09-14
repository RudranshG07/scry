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
	const anvilFirstAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

	signer, err := NewSigner(anvilFirstKey)
	if err != nil {
		t.Fatal(err)
	}
	if signer.Address != anvilFirstAddress {
		t.Fatalf("address = %s, want %s", signer.Address, anvilFirstAddress)
	}

	ctx := context.Background()
	client := New(url)

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

	nonce, err := client.NonceAt(ctx, signer.Address)
	if err != nil {
		t.Fatal(err)
	}
	if nonce == 0 {
		t.Fatal("nonce did not move; the node credited someone else")
	}
	_ = big.NewInt(0)
}
