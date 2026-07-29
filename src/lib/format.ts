const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "—";
  return usdWhole.format(value);
}

export function formatCompactUsd(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value < 10_000 ? usdWhole.format(value) : usdCompact.format(value);
}

export function formatUsdc(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} USDC`;
}

export function formatCount(value: number) {
  if (!Number.isFinite(value)) return "—";
  return wholeNumber.format(Math.round(value));
}

export function formatPercent(value: number, fractionDigits = 0) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatSignedPercent(value: number, fractionDigits = 1) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(fractionDigits)}%`;
}

export function formatRate(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

export function formatMultiplier(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `${value.toFixed(2)}×`;
}

export function formatAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export function formatLatency(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}
