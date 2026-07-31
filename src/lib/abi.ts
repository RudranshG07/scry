/**
 * Calldata for the handful of calls this app makes.
 *
 * Every argument here is a single 32-byte word, so encoding them by hand is a
 * few lines and avoids pulling a whole ABI library in for four functions. The
 * selectors are keccak hashes and cannot be derived in the browser without one,
 * so they are pinned as constants and checked against the compiled contracts in
 * tests/abi.test.mjs. A wrong selector calls a different function or none at
 * all, which is exactly the kind of thing that fails silently with money on it.
 */

export type HexString = `0x${string}`;

export const selectors = {
  approve: "0x095ea7b3",
  allowance: "0xdd62ed3e",
  balanceOf: "0x70a08231",
  deposit: "0x1de26e16",
  claim: "0x4e71d92d",
  refund: "0x590e1ae3",
  poolFor: "0xbde541a0",
  positionOf: "0x8b86d878",
  totalPool: "0xecfb49a3",
  status: "0x200d2ed2",
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

/** Outcome ids are short ascii ("yes", "no"), which solidity holds as bytes32
 * left-aligned. Right-padding is the opposite of every other type here, so it is
 * done explicitly rather than reusing padWord. */
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
  deposit: (outcomeId: string, amount: bigint) =>
    call(selectors.deposit, encodeBytes32(outcomeId), encodeUint(amount)),
  claim: () => call(selectors.claim),
  refund: () => call(selectors.refund),
  poolFor: (outcomeId: string) => call(selectors.poolFor, encodeBytes32(outcomeId)),
  positionOf: (account: string, outcomeId: string) =>
    call(selectors.positionOf, encodeAddress(account), encodeBytes32(outcomeId)),
  totalPool: () => call(selectors.totalPool),
  status: () => call(selectors.status),
};

/** USDC carries six decimals on both Base and Polygon. Parsing through a float
 * would round "0.1" to something that is not 0.1, so the decimal string is split
 * and padded instead. */
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
