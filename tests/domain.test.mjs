import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionMarket,
  isPositionableMarket,
  isTerminalMarket,
  marketStatuses,
  marketTransitions,
} from "../src/lib/domain.ts";

test("market lifecycle allows only declared forward transitions", () => {
  assert.equal(canTransitionMarket("Scheduled", "Open"), true);
  assert.equal(canTransitionMarket("Open", "Observing"), false);
  assert.equal(canTransitionMarket("Result proposed", "Challenged"), true);
  assert.deepEqual(marketTransitions.Resolved, []);
});

test("only open markets accept positions", () => {
  assert.equal(isPositionableMarket("Open"), true);
  assert.equal(isPositionableMarket("Scheduled"), false);
  assert.equal(isPositionableMarket("Observing"), false);
});

test("resolved and invalid markets are terminal", () => {
  assert.equal(isTerminalMarket("Resolved"), true);
  assert.equal(isTerminalMarket("Invalid"), true);
  assert.equal(isTerminalMarket("Challenged"), false);
});

test("the lifecycle exposes every required market state", () => {
  assert.deepEqual(marketStatuses, [
    "Scheduled",
    "Open",
    "Locked",
    "Observing",
    "Result proposed",
    "Challenged",
    "Resolved",
    "Invalid",
  ]);
});
