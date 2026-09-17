/** Reads and writes the market book through the connected wallet. */

import { decodeAddress, decodeUint, encode, errorSelectors, type HexString } from "./abi.ts";

export type Eip1193 = {
  request<T = unknown>(request: { method: string; params?: unknown[] }): Promise<T>;
};

/**
 * How much USDC one approval covers. Every market on a chain lives in one book,
 * so approving per position would ask a trader for two confirmations on every
 * four-minute window. Ten times what one wallet may stake on a market: enough
 * that the question is asked once, bounded so it is not a standing claim on the
 * whole balance.
 */
export const approvalCovers = 1_000_000_000n;

async function call(provider: Eip1193, to: string, data: HexString) {
  return provider.request<string>({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
}

async function read(provider: Eip1193, to: string, data: HexString): Promise<bigint> {
  return decodeUint(await call(provider, to, data));
}

/** Asked of the book itself. A token list kept here could name a different USDC
 * from the one the contract holds, and an approval against the wrong one leaves
 * the deposit to fail after the wallet has already asked for it. */
export async function collateralOf(provider: Eip1193, book: string): Promise<HexString> {
  return decodeAddress(await call(provider, book, encode.collateral()));
}

export async function allowance(provider: Eip1193, token: string, owner: string, spender: string) {
  return read(provider, token, encode.allowance(owner, spender));
}

export async function balanceOf(provider: Eip1193, token: string, owner: string) {
  return read(provider, token, encode.balanceOf(owner));
}

export async function poolFor(provider: Eip1193, book: string, marketKey: string, outcomeId: string) {
  return read(provider, book, encode.poolFor(marketKey, outcomeId));
}

export async function positionOf(
  provider: Eip1193,
  book: string,
  marketKey: string,
  account: string,
  outcomeId: string,
) {
  return read(provider, book, encode.positionOf(marketKey, account, outcomeId));
}

export async function totalPool(provider: Eip1193, book: string, marketKey: string) {
  return read(provider, book, encode.totalPool(marketKey));
}

export async function hasSettled(provider: Eip1193, book: string, marketKey: string, account: string) {
  return (await read(provider, book, encode.hasSettled(marketKey, account))) !== 0n;
}

async function send(provider: Eip1193, from: string, to: string, data: HexString) {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  });
}

/** Approves a run of positions rather than this one alone, and only when the
 * standing allowance no longer covers the trade. */
export async function approveIfNeeded(
  provider: Eip1193,
  token: string,
  owner: string,
  book: string,
  amount: bigint,
): Promise<string | null> {
  const current = await allowance(provider, token, owner, book);
  if (current >= amount) return null;
  return send(provider, owner, token, encode.approve(book, amount > approvalCovers ? amount : approvalCovers));
}

export async function deposit(
  provider: Eip1193,
  book: string,
  from: string,
  marketKey: string,
  outcomeId: string,
  amount: bigint,
) {
  return send(provider, from, book, encode.deposit(marketKey, outcomeId, amount));
}

export async function claim(provider: Eip1193, book: string, from: string, marketKey: string) {
  return send(provider, from, book, encode.claim(marketKey));
}

export async function refund(provider: Eip1193, book: string, from: string, marketKey: string) {
  return send(provider, from, book, encode.refund(marketKey));
}

type Receipt = { status: string; blockNumber: string | null };

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Resolves once a transaction is mined, and throws if it reverted. A deposit
 * sent before its approval is mined is estimated against the old allowance, and
 * the wallet refuses it. */
export async function waitForReceipt(
  provider: Eip1193,
  hash: string,
  { attempts = 120, intervalMs = 1_500 }: { attempts?: number; intervalMs?: number } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await provider.request<Receipt | null>({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt?.blockNumber) {
      if (receipt.status !== "0x1") throw new Error("The transaction was mined but reverted. Nothing moved.");
      return receipt;
    }
    await pause(intervalMs);
  }
  throw new Error("The transaction has not confirmed yet. Check your wallet before trying again.");
}

const revertMessages: Record<keyof typeof errorSelectors, string> = {
  StakeTooLarge: "That is more than one wallet can stake on this market.",
  PoolFull: "This market's pool is full.",
  Paused: "Deposits are paused for now. Nothing was taken.",
  WrongStatus: "The market is not taking that right now.",
  NothingToClaim: "There is nothing to collect for this wallet here.",
  AlreadySettled: "This wallet has already been paid out on this market.",
  UnknownOutcome: "That outcome is not part of this market.",
  ZeroAmount: "Enter an amount above zero.",
  NoSuchMarket: "This market is not on this network yet.",
  MarketExists: "This market is already open.",
};

function textOf(error: unknown) {
  try {
    return `${error instanceof Error ? error.message : ""} ${JSON.stringify(error) ?? ""}`.toLowerCase();
  } catch {
    return String(error).toLowerCase();
  }
}

/** Wallets report a contract's refusal as text naming only its error selector. */
export function describeRevert(error: unknown): string | null {
  const text = textOf(error);
  for (const [name, selector] of Object.entries(errorSelectors)) {
    if (text.includes(selector.slice(2))) return revertMessages[name as keyof typeof errorSelectors];
  }
  return null;
}

/** Hex-encoded so wallets render the words rather than raw bytes. */
export function toSignableHex(message: string): HexString {
  const bytes = new TextEncoder().encode(message);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `0x${hex}` as HexString;
}

export async function signIn(provider: Eip1193, address: string, message: string) {
  return provider.request<string>({
    method: "personal_sign",
    params: [toSignableHex(message), address],
  });
}
