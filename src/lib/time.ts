import type { Market, MarketStatus } from "./domain.ts";

export const lockGraceMs = 30_000;
export const challengeWindowMs = 10 * 60_000;

const scheduleFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const clockFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export const placeholderCountdown = "--:--";

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function formatCountdown(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "00:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatSchedule(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return scheduleFormatter.format(parsed);
}

export function formatWindow(opensAt: string, closesAt: string) {
  const start = new Date(opensAt);
  const end = new Date(closesAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  return `${clockFormatter.format(start)}–${clockFormatter.format(end)} IST`;
}

export function formatRelative(value: string, now: number) {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed) || now === 0) return formatSchedule(value);
  const elapsed = now - parsed;
  if (elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatSchedule(value);
}

const liveStatuses = new Set<MarketStatus>(["Open", "Locked", "Observing"]);

export function isLiveStatus(status: MarketStatus) {
  return liveStatuses.has(status);
}

export type MarketPhase = {
  status: MarketStatus;
  countdownLabel: string;
  remainingMs: number;
  observationProgress: number;
  isLive: boolean;
  isPending: boolean;
};

function boundaries(market: Market) {
  const opensAt = new Date(market.opensAt).getTime();
  const locksAt = new Date(market.locksAt).getTime();
  const observationEndsAt = new Date(market.observationEndsAt).getTime();
  return {
    opensAt,
    locksAt,
    observationStartsAt: locksAt + lockGraceMs,
    observationEndsAt,
    challengeEndsAt: observationEndsAt + challengeWindowMs,
  };
}

export function deriveStatus(market: Market, now: number): MarketStatus {
  if (now === 0) return market.status;
  const { opensAt, locksAt, observationStartsAt, observationEndsAt, challengeEndsAt } = boundaries(market);
  if (now < opensAt) return "Scheduled";
  if (now < locksAt) return "Open";
  if (now < observationStartsAt) return "Locked";
  if (now < observationEndsAt) return "Observing";
  if (market.status === "Invalid") return "Invalid";
  if (now < challengeEndsAt) return "Result proposed";
  return "Resolved";
}

export function marketPhase(market: Market, now: number): MarketPhase {
  const status = deriveStatus(market, now);
  const { opensAt, locksAt, observationStartsAt, observationEndsAt, challengeEndsAt } = boundaries(market);
  const observationSpan = Math.max(1, observationEndsAt - observationStartsAt);
  const observationProgress = now === 0
    ? 0
    : Math.min(1, Math.max(0, (now - observationStartsAt) / observationSpan));

  const targets: Record<MarketStatus, { label: string; at: number }> = {
    Scheduled: { label: "Opens in", at: opensAt },
    Open: { label: "Locks in", at: locksAt },
    Locked: { label: "Observation starts", at: observationStartsAt },
    Observing: { label: "Observation ends", at: observationEndsAt },
    "Result proposed": { label: "Challenge ends", at: challengeEndsAt },
    Challenged: { label: "Challenge ends", at: challengeEndsAt },
    Resolved: { label: "Settled", at: 0 },
    Invalid: { label: "Refundable", at: 0 },
  };

  const target = targets[status];
  return {
    status,
    countdownLabel: target.label,
    remainingMs: target.at === 0 || now === 0 ? 0 : Math.max(0, target.at - now),
    observationProgress,
    isLive: status === "Open" || status === "Locked" || status === "Observing",
    isPending: status === "Result proposed" || status === "Challenged",
  };
}

export function countdownFor(market: Market, now: number) {
  if (now === 0) return placeholderCountdown;
  const phase = marketPhase(market, now);
  if (phase.remainingMs === 0) return "00:00";
  return formatCountdown(phase.remainingMs);
}
