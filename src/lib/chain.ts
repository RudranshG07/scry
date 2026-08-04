/** Reads and writes the settlement contracts through the connected wallet. */

import { decodeUint, encode, type HexString } from "./abi.ts";

export type Eip1193 = {
  request<T = unknown>(request: { method: string; params?: unknown[] }): Promise<T>;
};

export const chains = {
  base: 8453,
  polygon: 137,
} as const;

/** Polygon runs two USDCs; Polymarket settles in the bridged USDC.e. Sending to
 * the wrong one succeeds and the balance never appears. */
export const collateral: Record<number, HexString> = {
  [chains.base]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [chains.polygon]: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
};

export function collateralFor(chainId: number): HexString {
  const token = collateral[chainId];
  if (!token) throw new Error(`Scry does not settle on chain ${chainId}.`);
  return token;
}

async function read(provider: Eip1193, to: string, data: HexString): Promise<bigint> {
  const result = await provider.request<string>({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  return decodeUint(result);
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
