import assert from "node:assert/strict";
import test from "node:test";

import { approvalCovers, approveIfNeeded, claim, collateralOf, deposit, describeRevert, toSignableHex, waitForReceipt } from "../src/lib/chain.ts";

const book = "0x000000000000000000000000000000000000dEaD";
const market = `0x${"ab".repeat(32)}`;
const trader = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function stubProvider(calls, { allowance = 0n, call, receipts = [] } = {}) {
  return {
    async request({ method, params }) {
      calls.push({ method, params });
      if (method === "eth_call") return call ?? `0x${allowance.toString(16).padStart(64, "0")}`;
      if (method === "eth_sendTransaction") return "0xtxhash";
      if (method === "eth_getTransactionReceipt") return receipts.shift() ?? null;
      throw new Error(`unexpected ${method}`);
    },
  };
}

test("the token is read from the book, not from a list kept here", async () => {
  const calls = [];
  const token = await collateralOf(
    stubProvider(calls, { call: `0x${"0".repeat(24)}833589fcd6edb6e08f4c7c32d4f71b54bda02913` }),
    book,
  );
  assert.equal(token, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(calls[0].params[0].to, book);
  assert.equal(calls[0].params[0].data, "0xd8dfeb45");
});

test("a standing allowance is never asked for again", async () => {
  const calls = [];
  const hash = await approveIfNeeded(stubProvider(calls, { allowance: 100n }), usdc, trader, book, 50n);
  assert.equal(hash, null);
  assert.equal(calls.filter((entry) => entry.method === "eth_sendTransaction").length, 0);
});

test("one approval covers a run of positions, not only this one", async () => {
  const calls = [];
  await approveIfNeeded(stubProvider(calls, { allowance: 0n }), usdc, trader, book, 50n);
  const sent = calls.find((entry) => entry.method === "eth_sendTransaction");

  // Every market on a chain is in this book. Approving exactly the stake would
  // ask for two confirmations on every four-minute window.
  assert.ok(sent.params[0].data.endsWith(approvalCovers.toString(16).padStart(64, "0")));
  // Bounded all the same: not a standing claim on the whole balance.
  assert.ok(!sent.params[0].data.includes("f".repeat(64)));
});

test("a stake larger than the usual approval is approved for what it needs", async () => {
  const calls = [];
  const huge = approvalCovers * 2n;
  await approveIfNeeded(stubProvider(calls, { allowance: 0n }), usdc, trader, book, huge);
  const sent = calls.find((entry) => entry.method === "eth_sendTransaction");
  assert.ok(sent.params[0].data.endsWith(huge.toString(16).padStart(64, "0")));
});

test("a position names its market, its outcome and its amount", async () => {
  const calls = [];
  await deposit(stubProvider(calls), book, trader, market, "yes", 5_000_000n);
  const sent = calls.find((entry) => entry.method === "eth_sendTransaction");

  assert.equal(sent.params[0].to, book);
  assert.equal(sent.params[0].from, trader);
  assert.ok(sent.params[0].data.startsWith(`0x9844b73f${"ab".repeat(32)}`));
  assert.ok(sent.params[0].data.includes("796573"));
});

test("collecting names the market too", async () => {
  const calls = [];
  await claim(stubProvider(calls), book, trader, market);
  const sent = calls.find((entry) => entry.method === "eth_sendTransaction");
  assert.equal(sent.params[0].data, `0xbd66528a${"ab".repeat(32)}`);
});

test("a pending transaction is waited for until it is mined", async () => {
  const calls = [];
  const receipt = await waitForReceipt(
    stubProvider(calls, { receipts: [null, null, { status: "0x1", blockNumber: "0x10" }] }),
    "0xtxhash",
    { intervalMs: 0 },
  );
  assert.equal(receipt.blockNumber, "0x10");
  assert.equal(calls.length, 3);
});

test("a mined transaction that reverted is an error, not a confirmation", async () => {
  await assert.rejects(
    waitForReceipt(stubProvider([], { receipts: [{ status: "0x0", blockNumber: "0x10" }] }), "0xtxhash", { intervalMs: 0 }),
    /reverted/,
  );
});

test("a transaction that never confirms stops being waited on", async () => {
  await assert.rejects(waitForReceipt(stubProvider([]), "0xtxhash", { attempts: 2, intervalMs: 0 }), /not confirmed/);
});

test("a contract's refusal is described in words", () => {
  const wallet = { code: -32603, message: "execution reverted", data: { code: 3, data: "0x1a64b33b" } };
  assert.match(describeRevert(wallet), /more than one wallet/);
  assert.match(describeRevert(new Error("reverted with custom error 0x560ff900")), /already been paid/);
  assert.match(describeRevert(new Error("reverted with custom error 0xac8a2f48")), /not on this network yet/);
  assert.equal(describeRevert(new Error("user rejected")), null);
});

test("the signed message reaches the wallet as readable text", () => {
  // Hex-encoded so wallets render the words; a signer cannot judge raw bytes.
  assert.equal(toSignableHex("hi"), "0x6869");
  assert.equal(Buffer.from(toSignableHex("Sign in to Scry.").slice(2), "hex").toString(), "Sign in to Scry.");
});
