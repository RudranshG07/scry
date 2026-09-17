import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { decodeAddress, decodeUint, encode, encodeBytes32, encodeMarketKey, errorSelectors, fromUsdc, selectors, toUsdc } from "../src/lib/abi.ts";

// Every market lives in one book, so every call names the market it means.
const market = `0x${"ab".repeat(32)}`;

// Selectors are keccak hashes, which cannot be computed in the browser without a
// hashing library. They are pinned as constants, so the only thing standing
// between a typo and a transaction that calls the wrong function is this test.
const signatures = {
  approve: "approve(address,uint256)",
  allowance: "allowance(address,address)",
  balanceOf: "balanceOf(address)",
  deposit: "deposit(bytes32,bytes32,uint256)",
  claim: "claim(bytes32)",
  refund: "refund(bytes32)",
  poolFor: "poolFor(bytes32,bytes32)",
  positionOf: "positionOf(bytes32,address,bytes32)",
  totalPool: "totalPool(bytes32)",
  status: "status(bytes32)",
  collateral: "collateral()",
  maxStake: "maxStake()",
  stakedBy: "stakedBy(bytes32,address)",
  hasSettled: "hasSettled(bytes32,address)",
};

test("every pinned selector matches the compiled signature", (t) => {
  let cast;
  try {
    cast = execFileSync("cast", ["--version"], { encoding: "utf8" });
  } catch {
    t.skip("foundry's cast is not installed");
    return;
  }
  assert.ok(cast);
  for (const [name, signature] of Object.entries(signatures)) {
    const actual = execFileSync("cast", ["sig", signature], { encoding: "utf8" }).trim();
    assert.equal(selectors[name], actual, `${name} (${signature})`);
  }
});

test("every pinned error selector matches the error the market reverts with", (t) => {
  try {
    execFileSync("cast", ["--version"], { encoding: "utf8" });
  } catch {
    t.skip("foundry's cast is not installed");
    return;
  }
  for (const [name, selector] of Object.entries(errorSelectors)) {
    assert.equal(selector, execFileSync("cast", ["sig", `${name}()`], { encoding: "utf8" }).trim(), name);
  }
});

test("an address comes back out of the last twenty bytes of its word", () => {
  assert.equal(decodeAddress(`0x${"0".repeat(24)}833589fcd6edb6e08f4c7c32d4f71b54bda02913`), "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.throws(() => decodeAddress("0x"));
});

test("addresses and amounts each occupy one left-padded word", () => {
  const data = encode.approve("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 1_500_000n);
  assert.equal(data.length, 2 + 8 + 64 * 2);
  assert.ok(data.startsWith("0x095ea7b3"));
  assert.ok(data.includes("833589fcd6edb6e08f4c7c32d4f71b54bda02913"));
  assert.ok(data.endsWith("16e360"));
});

test("outcome ids are right-padded, unlike every other type", () => {
  // Solidity holds bytes32 left-aligned. Padding these the same way as a number
  // would send a different outcome id than the one on screen.
  assert.equal(encodeBytes32("yes"), "796573".padEnd(64, "0"));
  assert.ok(encode.deposit(market, "yes", 1n).startsWith(`${selectors.deposit}${"ab".repeat(32)}796573`));
});

test("a market id is a whole word and is never guessed at", () => {
  assert.equal(encodeMarketKey(market), "ab".repeat(32));
  assert.equal(encodeMarketKey("ab".repeat(32)), "ab".repeat(32));
  // The API sends this hash because a browser cannot compute it. Anything else
  // would name a market the book has never heard of.
  assert.throws(() => encodeMarketKey("0xabc"));
  assert.throws(() => encodeMarketKey("market-1"));
});

test("an outcome id too long for a word is refused rather than truncated", () => {
  assert.throws(() => encodeBytes32("x".repeat(33)));
});

test("a malformed address never reaches the wallet", () => {
  assert.throws(() => encode.approve("0xnope", 1n));
  assert.throws(() => encode.approve("", 1n));
});

test("collecting names the market and nothing else", () => {
  assert.equal(encode.claim(market), `${selectors.claim}${"ab".repeat(32)}`);
  assert.equal(encode.refund(market), `${selectors.refund}${"ab".repeat(32)}`);
  assert.equal(encode.collateral(), selectors.collateral);
});

test("USDC amounts survive the round trip without floating point", () => {
  for (const amount of ["0", "1", "0.1", "0.000001", "25", "1234.567891"]) {
    assert.equal(fromUsdc(toUsdc(amount)), amount === "0" ? "0" : amount);
  }
});

test("0.1 USDC is exactly 100000 units", () => {
  // Through a float this lands on 99999.99999999999.
  assert.equal(toUsdc("0.1"), 100_000n);
  assert.equal(toUsdc("0.07"), 70_000n);
});

test("more precision than USDC has is refused, not silently rounded", () => {
  assert.throws(() => toUsdc("0.0000001"));
});

test("junk amounts are refused", () => {
  for (const bad of ["", ".", "abc", "1.2.3", "-5", "1e6"]) {
    assert.throws(() => toUsdc(bad), new RegExp("."), `accepted ${bad}`);
  }
});

test("returned words decode back to the value", () => {
  assert.equal(decodeUint(`0x${(12345n).toString(16).padStart(64, "0")}`), 12345n);
  assert.equal(decodeUint("0x"), 0n);
});
