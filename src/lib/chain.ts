/** Reads and writes the settlement contracts through the connected wallet. */

import { decodeAddress, decodeUint, encode, errorSelectors, type HexString } from "./abi.ts";

export type Eip1193 = {
  request<T = unknown>(request: { method: string; params?: unknown[] }): Promise<T>;
};

async function call(provider: Eip1193, to: string, data: HexString) {
  return provider.request<string>({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
}

async function read(provider: Eip1193, to: string, data: HexString): Promise<bigint> {
  return decodeUint(await call(provider, to, data));
}

/** Asked of the market itself. A token list kept here could name a different
 * USDC from the one the contract holds, and an approval against the wrong one
 * leaves the deposit to fail after the wallet has already asked for it. */
export async function collateralOf(provider: Eip1193, market: string): Promise<HexString> {
  return decodeAddress(await call(provider, market, encode.collateral()));
}

export async function allowance(provider: Eip1193, token: string, owner: string, spender: string) {
  return read(provider, token, encode.allowance(owner, spender));
}

export async function balanceOf(provider: Eip1193, token: string, owner: string) {
  return read(provider, token, encode.balanceOf(owner));
}

export async function poolFor(provider: Eip1193, market: string, outcomeId: string) {
  return read(provider, market, encode.poolFor(outcomeId));
}

export async function positionOf(provider: Eip1193, market: string, account: string, outcomeId: string) {
  return read(provider, market, encode.positionOf(account, outcomeId));
}

export async function totalPool(provider: Eip1193, market: string) {
  return read(provider, market, encode.totalPool());
}

export async function hasSettled(provider: Eip1193, market: string, account: string) {
  return (await read(provider, market, encode.hasSettled(account))) !== 0n;
}

async function send(provider: Eip1193, from: string, to: string, data: HexString) {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  });
}

/** Approves only this deposit. An unlimited allowance would outlive the market. */
export async function approveIfNeeded(
  provider: Eip1193,
  token: string,
  owner: string,
  market: string,
  amount: bigint,
): Promise<string | null> {
  const current = await allowance(provider, token, owner, market);
  if (current >= amount) return null;
  return send(provider, owner, token, encode.approve(market, amount));
}

export async function deposit(
  provider: Eip1193,
  market: string,
  from: string,
  outcomeId: string,
  amount: bigint,
) {
  return send(provider, from, market, encode.deposit(outcomeId, amount));
}

export async function claim(provider: Eip1193, market: string, from: string) {
  return send(provider, from, market, encode.claim());
}

export async function refund(provider: Eip1193, market: string, from: string) {
  return send(provider, from, market, encode.refund());
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
