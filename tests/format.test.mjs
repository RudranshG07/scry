import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAddress,
  formatCompactUsd,
  formatCount,
  formatHash,
  formatLatency,
  formatMultiplier,
  formatPercent,
  formatSignedPercent,
  formatRate,
  formatUsd,
  formatUsdc,
} from "../src/lib/format.ts";

test("currency switches to compact notation only above ten thousand", () => {
  assert.equal(formatCompactUsd(8420), "$8,420");
  assert.equal(formatCompactUsd(12680), "$12.7K");
  assert.equal(formatUsd(8420), "$8,420");
});

test("usdc amounts always carry two decimals", () => {
  assert.equal(formatUsdc(25), "25.00 USDC");
  assert.equal(formatUsdc(118.297), "118.30 USDC");
});

test("signed percentages keep an explicit direction", () => {
  assert.equal(formatSignedPercent(8.24), "+8.2%");
  assert.equal(formatSignedPercent(-3.15), "-3.1%");
  assert.equal(formatSignedPercent(0), "0.0%");
  assert.equal(formatPercent(99.837, 2), "99.84%");
});

test("counts round to whole events with separators", () => {
  assert.equal(formatCount(1842.6), "1,843");
  assert.equal(formatRate(17.44), "17.4");
});

test("multipliers and identifiers truncate predictably", () => {
  assert.equal(formatMultiplier(1.5625), "1.56×");
  assert.equal(formatMultiplier(0), "—");
  assert.equal(formatAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
  assert.equal(formatAddress("0x1234"), "0x1234");
  assert.equal(formatHash(`0x${"a".repeat(64)}`), "0xaaaaaa…aaaa");
});

test("latency crosses over to seconds past one thousand milliseconds", () => {
  assert.equal(formatLatency(820), "820ms");
  assert.equal(formatLatency(999), "999ms");
  assert.equal(formatLatency(1500), "1.5s");
  assert.equal(formatLatency(2400), "2.4s");
});

test("non-finite values render an em dash rather than NaN", () => {
  assert.equal(formatUsd(Number.NaN), "—");
  assert.equal(formatCount(Number.POSITIVE_INFINITY), "—");
  assert.equal(formatPercent(Number.NaN), "—");
  assert.equal(formatRate(Number.NaN), "—");
});
