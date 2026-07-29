import assert from "node:assert/strict";
import test from "node:test";
import { marketSeeds } from "../src/lib/markets.ts";
import {
  findMarketAt,
  listMarketsAt,
  liveCountFor,
  proofFor,
  syntheticHash,
} from "../src/lib/simulation.ts";
import { marketPhase } from "../src/lib/time.ts";

const anchor = Date.UTC(2026, 6, 26, 12, 0, 0);
const minute = 60_000;

test("every seed materializes into a market", () => {
  const markets = listMarketsAt(anchor);
  assert.equal(markets.length, marketSeeds.length);
  for (const market of markets) {
    assert.ok(new Date(market.opensAt).getTime() < new Date(market.locksAt).getTime());
    assert.ok(new Date(market.locksAt).getTime() < new Date(market.observationEndsAt).getTime());
  }
});

test("materialization is deterministic for the same instant", () => {
  assert.deepEqual(listMarketsAt(anchor), listMarketsAt(anchor));
});

test("outcome probabilities always sum to one hundred", () => {
  for (let step = 0; step < 96; step += 1) {
    for (const market of listMarketsAt(anchor + step * 15 * minute)) {
      const total = market.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
      assert.equal(total, 100, `${market.id} probabilities did not sum to 100`);
    }
  }
});

test("return rates are the parimutuel inverse of pool share", () => {
  for (const market of listMarketsAt(anchor)) {
    for (const outcome of market.outcomes) {
      const expected = Number((1 / (outcome.probability / 100)).toFixed(2));
      assert.equal(outcome.returnRate, expected, `${market.id}/${outcome.id} return rate is inconsistent`);
    }
  }
});

test("at least one market is live at every point across two days", () => {
  for (let step = 0; step < 576; step += 1) {
    const now = anchor + step * 5 * minute;
    const live = listMarketsAt(now).filter((market) => marketPhase(market, now).isLive);
    assert.ok(live.length > 0, `no live market at offset ${step}`);
  }
});

test("markets recycle so a scheduled window always follows a resolved one", () => {
  const seed = marketSeeds[0];
  const cycle = seed.cycleMinutes * minute;
  const first = findMarketAt(seed.id, anchor);
  const next = findMarketAt(seed.id, anchor + cycle);
  assert.ok(first && next);
  assert.equal(new Date(next.opensAt).getTime() - new Date(first.opensAt).getTime(), cycle);
});

test("observed counts only accumulate once observation starts", () => {
  const seed = marketSeeds.find((item) => !item.archived && !item.invalid);
  const market = findMarketAt(seed.id, anchor);
  const opensAt = new Date(market.opensAt).getTime();
  assert.equal(liveCountFor(market, opensAt), 0);

  const endsAt = new Date(market.observationEndsAt).getTime();
  const finalCount = liveCountFor(market, endsAt);
  assert.ok(finalCount > 0);
  assert.ok(liveCountFor(market, endsAt - 2 * minute) <= finalCount);
});

test("resolved markets name a winner consistent with the threshold", () => {
  const seed = marketSeeds.find((item) => item.archived && !item.invalid);
  const market = findMarketAt(seed.id, anchor);
  assert.equal(marketPhase(market, anchor).status, "Resolved");
  assert.ok(market.observedValue !== undefined);
  const expected = market.observedValue > seed.threshold ? seed.outcomes[0].id : seed.outcomes[1].id;
  assert.equal(market.winningOutcomeId, expected);
});

test("an invalid market reports no winner and a degraded quorum", () => {
  const seed = marketSeeds.find((item) => item.invalid);
  const market = findMarketAt(seed.id, anchor);
  assert.equal(market.status, "Invalid");
  assert.equal(market.winningOutcomeId, undefined);
  assert.equal(market.observers, 1);
});

test("proof commitments are per market and stable", () => {
  const first = findMarketAt(marketSeeds[0].id, anchor);
  const second = findMarketAt(marketSeeds[1].id, anchor);
  const firstProof = proofFor(first, anchor);
  const secondProof = proofFor(second, anchor);

  assert.notEqual(firstProof.ruleHash, secondProof.ruleHash);
  assert.deepEqual(firstProof, proofFor(first, anchor));
  assert.equal(firstProof.observers.length, 3);
  assert.match(firstProof.ruleHash, /^0x[0-9a-f]{64}$/);
});

test("an unfinished observation withholds the evidence root", () => {
  const seed = marketSeeds.find((item) => !item.archived && !item.invalid);
  const market = findMarketAt(seed.id, anchor);
  const openAt = new Date(market.opensAt).getTime() + minute;
  const proof = proofFor(market, openAt);
  assert.equal(proof.evidenceRoot, null);
  assert.equal(proof.challengeEndsAt, null);
  assert.equal(proof.status, "Collecting");
});

test("synthetic hashes are stable, distinct and well formed", () => {
  assert.equal(syntheticHash("scry"), syntheticHash("scry"));
  assert.notEqual(syntheticHash("scry"), syntheticHash("scry "));
  assert.match(syntheticHash("scry"), /^0x[0-9a-f]{64}$/);
});
