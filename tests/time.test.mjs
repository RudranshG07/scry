import assert from "node:assert/strict";
import test from "node:test";
import {
  challengeWindowMs,
  countdownFor,
  deriveStatus,
  formatCountdown,
  isLiveStatus,
  lockGraceMs,
  marketPhase,
  placeholderCountdown,
} from "../src/lib/time.ts";

const minute = 60_000;
const opensAt = Date.UTC(2026, 6, 26, 12, 0, 0);
const locksAt = opensAt + 8 * minute;
const observationEndsAt = locksAt + 15 * minute;

const market = {
  id: "test-market",
  streamId: "stream-test",
  category: "Traffic",
  location: "Gate A",
  city: "Indore",
  question: "Will crossings exceed 180?",
  status: "Open",
  countdown: "00:00",
  pool: 1000,
  forecast: 60,
  currentRate: 12,
  baseline: 12,
  observers: 3,
  opensAt: new Date(opensAt).toISOString(),
  locksAt: new Date(locksAt).toISOString(),
  observationEndsAt: new Date(observationEndsAt).toISOString(),
  outcomes: [
    { id: "yes", label: "Yes", probability: 60, returnRate: 1.67 },
    { id: "no", label: "No", probability: 40, returnRate: 2.5 },
  ],
  trend: [50, 55, 60],
};

test("countdown formats minutes and hours without drift", () => {
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(-5000), "00:00");
  assert.equal(formatCountdown(45_000), "00:45");
  assert.equal(formatCountdown(9 * minute + 5000), "09:05");
  assert.equal(formatCountdown(3 * 3600_000 + 4 * minute + 7000), "3:04:07");
});

test("status walks the full lifecycle as time advances", () => {
  assert.equal(deriveStatus(market, opensAt - minute), "Scheduled");
  assert.equal(deriveStatus(market, opensAt + minute), "Open");
  assert.equal(deriveStatus(market, locksAt + lockGraceMs / 2), "Locked");
  assert.equal(deriveStatus(market, locksAt + lockGraceMs + minute), "Observing");
  assert.equal(deriveStatus(market, observationEndsAt + minute), "Result proposed");
  assert.equal(deriveStatus(market, observationEndsAt + challengeWindowMs + minute), "Resolved");
});

test("an invalid seed stays invalid once observation closes", () => {
  const invalidMarket = { ...market, status: "Invalid" };
  assert.equal(deriveStatus(invalidMarket, locksAt + lockGraceMs + minute), "Observing");
  assert.equal(deriveStatus(invalidMarket, observationEndsAt + minute), "Invalid");
  assert.equal(deriveStatus(invalidMarket, observationEndsAt + challengeWindowMs + minute), "Invalid");
});

test("observation progress runs from zero to one across the window", () => {
  assert.equal(marketPhase(market, opensAt).observationProgress, 0);
  const midpoint = locksAt + lockGraceMs + (observationEndsAt - locksAt - lockGraceMs) / 2;
  assert.ok(Math.abs(marketPhase(market, midpoint).observationProgress - 0.5) < 0.01);
  assert.equal(marketPhase(market, observationEndsAt + minute).observationProgress, 1);
});

test("countdown targets the next lifecycle boundary", () => {
  const phase = marketPhase(market, opensAt + 3 * minute);
  assert.equal(phase.countdownLabel, "Locks in");
  assert.equal(phase.remainingMs, 5 * minute);
  assert.equal(countdownFor(market, opensAt + 3 * minute), "05:00");
});

test("a zero clock renders a placeholder instead of a wrong time", () => {
  assert.equal(countdownFor(market, 0), placeholderCountdown);
  assert.equal(deriveStatus(market, 0), market.status);
  assert.equal(marketPhase(market, 0).remainingMs, 0);
});

test("terminal states expose no countdown", () => {
  const phase = marketPhase(market, observationEndsAt + challengeWindowMs + minute);
  assert.equal(phase.status, "Resolved");
  assert.equal(phase.remainingMs, 0);
  assert.equal(phase.isLive, false);
});

test("live statuses cover the participation window only", () => {
  assert.equal(isLiveStatus("Open"), true);
  assert.equal(isLiveStatus("Observing"), true);
  assert.equal(isLiveStatus("Scheduled"), false);
  assert.equal(isLiveStatus("Resolved"), false);
});
