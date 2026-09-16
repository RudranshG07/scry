import assert from "node:assert/strict";
import test from "node:test";

import { hexChainId, networkFor, parseChainId, settledNetworks, transactionUrl } from "../src/lib/networks.ts";

test("wallets are asked for chains in hex and answer in hex", () => {
  assert.equal(hexChainId(8453), "0x2105");
  assert.equal(hexChainId(137), "0x89");
  assert.equal(parseChainId("0x2105"), 8453);
  assert.equal(parseChainId("nonsense"), null);
});

test("only networks the API settles on are offered, mainnets first", () => {
  assert.deepEqual(settledNetworks([80002, 84532, 1]).map((network) => network.chainId), [84532, 80002]);
  assert.deepEqual(settledNetworks([137, 8453]).map((network) => network.name), ["Base", "Polygon"]);
});

test("an unknown chain has no network and no explorer link", () => {
  assert.equal(networkFor(1), null);
  assert.equal(transactionUrl(1, "0xabc"), null);
  assert.equal(transactionUrl(8453, "0xabc"), "https://basescan.org/tx/0xabc");
  assert.equal(transactionUrl(31338, "0xabc"), null);
});
