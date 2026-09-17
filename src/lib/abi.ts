/**
 * Calldata for the few calls this app makes. Every argument is one 32-byte word,
 * so hand encoding avoids an ABI library. Selectors are keccak hashes, which the
 * browser cannot derive, so they are pinned and checked against the compiled
 * contracts in tests/abi.test.mjs.
 */

export type HexString = `0x${string}`;

export const selectors = {
  approve: "0x095ea7b3",
  allowance: "0xdd62ed3e",
  balanceOf: "0x70a08231",
  deposit: "0x9844b73f",
  claim: "0xbd66528a",
  refund: "0x7249fbb6",
  poolFor: "0xf47e9321",
  positionOf: "0xeb7d65ff",
  totalPool: "0x069bb172",
  status: "0x52ad0d5e",
  collateral: "0xd8dfeb45",
  maxStake: "0xea1b28e0",
  stakedBy: "0x4ea050c4",
  hasSettled: "0x3dd534b1",
} as const;

/** Custom errors the market reverts with, pinned and checked the same way. */
export const errorSelectors = {
  StakeTooLarge: "0x1a64b33b",
  PoolFull: "0x9e80781c",
  Paused: "0x9e87fac8",
  WrongStatus: "0x8e78f0cb",
  NothingToClaim: "0x969bf728",
  AlreadySettled: "0x560ff900",
  UnknownOutcome: "0x7c436a95",
  ZeroAmount: "0x1f2a2005",
  NoSuchMarket: "0xac8a2f48",
  MarketExists: "0x8fc6f59b",
} as const;

export function padWord(value: string): string {
  const bare = value.replace(/^0x/, "").toLowerCase();
  if (bare.length > 64) throw new Error("value does not fit in one word");
  return bare.padStart(64, "0");
}

export function encodeAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`not an address: ${address}`);
  return padWord(address);
}

export function encodeUint(value: bigint): string {
  if (value < 0n) throw new Error("uint cannot be negative");
  return padWord(value.toString(16));
}

/** A market id is already a whole word: the hash the book knows it by, which
 * the API sends because a browser cannot hash. */
export function encodeMarketKey(key: string): string {
  const bare = key.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(bare)) throw new Error(`not a market id: ${key}`);
  return bare;
}

/** Solidity holds bytes32 left-aligned, the opposite of every other type here. */
export function encodeBytes32(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 32) throw new Error("outcome id is too long for bytes32");
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex.padEnd(64, "0");
}

export function call(selector: string, ...words: string[]): HexString {
  return `${selector}${words.join("")}` as HexString;
}

export function decodeAddress(data: string): HexString {
  const bare = data.replace(/^0x/, "");
  if (bare.length < 64) throw new Error("not an address word");
  return `0x${bare.slice(24, 64)}` as HexString;
}

export function decodeUint(data: string): bigint {
  const bare = data.replace(/^0x/, "");
  if (bare.length === 0) return 0n;
  return BigInt(`0x${bare.slice(-64)}`);
}

export const encode = {
  approve: (spender: string, amount: bigint) =>
    call(selectors.approve, encodeAddress(spender), encodeUint(amount)),
  allowance: (owner: string, spender: string) =>
    call(selectors.allowance, encodeAddress(owner), encodeAddress(spender)),
  balanceOf: (owner: string) => call(selectors.balanceOf, encodeAddress(owner)),
  deposit: (marketKey: string, outcomeId: string, amount: bigint) =>
    call(selectors.deposit, encodeMarketKey(marketKey), encodeBytes32(outcomeId), encodeUint(amount)),
  claim: (marketKey: string) => call(selectors.claim, encodeMarketKey(marketKey)),
  refund: (marketKey: string) => call(selectors.refund, encodeMarketKey(marketKey)),
  poolFor: (marketKey: string, outcomeId: string) =>
    call(selectors.poolFor, encodeMarketKey(marketKey), encodeBytes32(outcomeId)),
  positionOf: (marketKey: string, account: string, outcomeId: string) =>
    call(selectors.positionOf, encodeMarketKey(marketKey), encodeAddress(account), encodeBytes32(outcomeId)),
  totalPool: (marketKey: string) => call(selectors.totalPool, encodeMarketKey(marketKey)),
  status: (marketKey: string) => call(selectors.status, encodeMarketKey(marketKey)),
  collateral: () => call(selectors.collateral),
  maxStake: () => call(selectors.maxStake),
  stakedBy: (marketKey: string, account: string) =>
    call(selectors.stakedBy, encodeMarketKey(marketKey), encodeAddress(account)),
  hasSettled: (marketKey: string, account: string) =>
    call(selectors.hasSettled, encodeMarketKey(marketKey), encodeAddress(account)),
};

/** Six decimals on both chains. A float would round "0.1" to something else. */
export const usdcDecimals = 6;

export function toUsdc(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(`not an amount: ${amount}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > usdcDecimals) throw new Error("USDC has six decimal places");
  return BigInt(`${whole || "0"}${fraction.padEnd(usdcDecimals, "0")}`);
}

export function fromUsdc(amount: bigint): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const unit = 10n ** BigInt(usdcDecimals);
  const whole = absolute / unit;
  const fraction = (absolute % unit).toString().padStart(usdcDecimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
