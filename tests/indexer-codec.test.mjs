import assert from "node:assert/strict";
import test from "node:test";
import { decodeFinalizedEvent } from "../services/indexer/event-codec.ts";

function placement() {
  return {
    type: "position.placed",
    eventId: "8453:0xabc:0",
    chainId: 8453,
    blockNumber: "21474836480",
    transactionIndex: 1,
    logIndex: 0,
    transactionHash: `0x${"a".repeat(64)}`,
    blockHash: `0x${"b".repeat(64)}`,
    recordedAt: "2026-07-20T14:00:00.000Z",
    marketId: "market-1",
    account: `0x${"1".repeat(40)}`,
    outcomeId: "yes",
    amount: "25000000",
  };
}

test("finalized event decoder preserves full-width integer amounts", () => {
  const decoded = decodeFinalizedEvent(placement());
  assert.equal(decoded.blockNumber, 21_474_836_480n);
  assert.equal(decoded.amount, 25_000_000n);
});

test("finalized event decoder rejects malformed hashes and negative amounts", () => {
  assert.throws(() => decodeFinalizedEvent({ ...placement(), transactionHash: "0xabc" }), TypeError);
  assert.throws(() => decodeFinalizedEvent({ ...placement(), amount: "-1" }), TypeError);
});
