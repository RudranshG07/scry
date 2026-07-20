import assert from "node:assert/strict";
import test from "node:test";
import { MarketProjector, ProjectorError } from "../services/indexer/projector.ts";

const account = "0x1111111111111111111111111111111111111111";

function event(type, sequence, data = {}) {
  return {
    type,
    eventId: `event-${sequence}`,
    chainId: 8453,
    blockNumber: 100n + BigInt(sequence),
    transactionIndex: 0,
    logIndex: 0,
    transactionHash: `0x${String(sequence).padStart(64, "0")}`,
    blockHash: `0x${String(sequence + 100).padStart(64, "0")}`,
    recordedAt: `2026-07-20T14:00:${String(sequence).padStart(2, "0")}.000Z`,
    marketId: "market-1",
    ...data,
  };
}

function created(sequence = 1) {
  return event("market.created", sequence, {
    contractAddress: "0x2222222222222222222222222222222222222222",
    streamId: "stream-1",
    ruleHash: `0x${"a".repeat(64)}`,
    outcomes: ["yes", "no"],
    initialStatus: "Open",
  });
}

test("projector builds the resolved market and payout view", () => {
  const projector = new MarketProjector();
  projector.apply(created());
  projector.apply(event("position.placed", 2, { account, outcomeId: "yes", amount: 25_000_000n }));
  projector.apply(event("market.locked", 3));
  projector.apply(event("observation.proposed", 4, {
    observedValue: 182n,
    winningOutcomeId: "yes",
    evidenceRoot: `0x${"b".repeat(64)}`,
  }));
  projector.apply(event("market.resolved", 5));
  projector.apply(event("payout.claimed", 6, { account, outcomeId: "yes", amount: 39_000_000n }));

  assert.equal(projector.markets.get("market-1").status, "Resolved");
  assert.equal(projector.markets.get("market-1").totalPool, 25_000_000n);
  assert.equal(projector.positions.get(`market-1:${account}:yes`).claimedAmount, 39_000_000n);
});

test("projector ignores an exact duplicate without double counting", () => {
  const projector = new MarketProjector();
  projector.apply(created());
  const placed = event("position.placed", 2, { account, outcomeId: "yes", amount: 25n });
  assert.equal(projector.apply(placed), true);
  assert.equal(projector.apply(placed), false);
  assert.equal(projector.markets.get("market-1").totalPool, 25n);
});

test("projector rejects reused event identities and out-of-order lifecycle events", () => {
  const projector = new MarketProjector();
  projector.apply(created());
  assert.throws(
    () => projector.apply({ ...created(), streamId: "different" }),
    ProjectorError,
  );
  assert.throws(
    () => projector.apply(event("market.resolved", 2)),
    ProjectorError,
  );
});

test("invalid markets project principal refunds", () => {
  const projector = new MarketProjector();
  projector.apply(created());
  projector.apply(event("position.placed", 2, { account, outcomeId: "no", amount: 50n }));
  projector.apply(event("market.invalidated", 3));
  projector.apply(event("refund.claimed", 4, { account, outcomeId: "no", amount: 50n }));
  assert.equal(projector.markets.get("market-1").status, "Invalid");
  assert.equal(projector.positions.get(`market-1:${account}:no`).refundedAmount, 50n);
});

test("projector rejects events from another chain and earlier chain positions", () => {
  const projector = new MarketProjector();
  projector.apply(created(2));
  assert.throws(
    () => projector.apply({ ...event("market.locked", 3), chainId: 1 }),
    ProjectorError,
  );
  assert.throws(
    () => projector.apply(event("market.locked", 1)),
    ProjectorError,
  );
});
