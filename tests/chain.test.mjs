import assert from "node:assert/strict";
import test from "node:test";

import { approveIfNeeded, chains, collateralFor, toSignableHex } from "../src/lib/chain.ts";

function stubProvider(calls, { allowance = 0n } = {}) {
  return {
    async request({ method, params }) {
      calls.push({ method, params });
      if (method === "eth_call") return `0x${allowance.toString(16).padStart(64, "0")}`;
      if (method === "eth_sendTransaction") return "0xtxhash";
      throw new Error(`unexpected ${method}`);
    },
  };
}

test("polygon settles in bridged USDC.e, not native USDC", () => {
  // Polymarket settles in USDC.e. Native USDC on Polygon is a different
  // contract, and money sent there simply never appears.
  assert.equal(collateralFor(chains.polygon), "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174");
  assert.equal(collateralFor(chains.base), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.notEqual(collateralFor(chains.polygon), collateralFor(chains.base));
});

test("an unsupported chain refuses rather than guessing a token", () => {
  assert.throws(() => collateralFor(1));
});

test("approval is skipped when the allowance already covers the deposit", async () => {
  const calls = [];
  const hash = await approveIfNeeded(
    stubProvider(calls, { allowance: 100n }),
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
    "0x000000000000000000000000000000000000dEaD",
    50n,
  );
  assert.equal(hash, null);
  assert.equal(calls.filter((c) => c.method === "eth_sendTransaction").length, 0);
});

test("approval covers exactly the deposit, never an unlimited allowance", async () => {
  const calls = [];
  await approveIfNeeded(
    stubProvider(calls, { allowance: 0n }),
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
    "0x000000000000000000000000000000000000dEaD",
    50n,
  );
  const sent = calls.find((c) => c.method === "eth_sendTransaction");
  // An unlimited approval would let the market move the whole balance long
  // after it has settled.
  assert.ok(sent.params[0].data.endsWith((50n).toString(16).padStart(64, "0")));
  assert.ok(!sent.params[0].data.includes("f".repeat(64)));
});

test("the signed message reaches the wallet as readable text", () => {
  // Hex-encoded so wallets render the words; a signer cannot judge raw bytes.
  assert.equal(toSignableHex("hi"), "0x6869");
  assert.equal(Buffer.from(toSignableHex("Sign in to Scry.").slice(2), "hex").toString(), "Sign in to Scry.");
});
