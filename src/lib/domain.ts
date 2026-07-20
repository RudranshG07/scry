export const marketStatuses = [
  "Scheduled",
  "Open",
  "Locked",
  "Observing",
  "Result proposed",
  "Challenged",
  "Resolved",
  "Invalid",
] as const;

export type MarketStatus = (typeof marketStatuses)[number];
export type Category = "Traffic" | "Parking" | "Queues" | "Operations";

export type MarketOutcome = {
  id: string;
  label: string;
  probability: number;
  returnRate: number;
};

export type Market = {
  id: string;
  streamId: string;
  category: Category;
  location: string;
  city: string;
  question: string;
  status: MarketStatus;
  countdown: string;
  pool: number;
  forecast: number;
  currentRate: number;
  baseline: number;
  observers: number;
  opensAt: string;
  locksAt: string;
  observationEndsAt: string;
  resolvedAt?: string;
  observedValue?: number;
  winningOutcomeId?: string;
  outcomes: MarketOutcome[];
  trend: number[];
};

export type ObserverState = "Healthy" | "Reconnecting" | "Disagreed" | "Signed";

export type Observer = {
  id: string;
  name: string;
  role: "Edge" | "Primary vision" | "Independent verification";
  state: ObserverState;
  modelVersion: string;
  signature?: `0x${string}`;
};

export type ProofOfObservation = {
  marketId: string;
  streamId: string;
  status: "Collecting" | "Proposed" | "Final" | "Invalid";
  observedValue: number | null;
  winningOutcomeId: string | null;
  ruleHash: `0x${string}`;
  evidenceRoot: `0x${string}` | null;
  observationWindow: {
    opensAt: string;
    closesAt: string;
  };
  minimumUptime: number;
  measuredUptime: number;
  challengeEndsAt: string | null;
  observers: Observer[];
};

export type PositionState = "Open" | "Claimable" | "Claimed" | "Refundable" | "Refunded";

export type Position = {
  id: string;
  marketId: string;
  question: string;
  outcomeLabel: string;
  amount: number;
  estimatedReturn: number;
  state: PositionState;
  createdAt: string;
};

export type Portfolio = {
  address: `0x${string}`;
  balance: number;
  totalPositioned: number;
  claimable: number;
  positions: Position[];
};

export type LeaderboardEntry = {
  rank: number;
  id: string;
  displayName: string;
  kind: "Human" | "Agent";
  specialty: Category;
  forecasts: number;
  brierScore: number;
  calibration: number;
};

export type RoomMessage = {
  id: string;
  marketId: string;
  author: string;
  kind: "Human" | "Agent" | "System";
  body: string;
  createdAt: string;
};

export type CreateRoomMessage = {
  author: string;
  body: string;
};

export type ScryNotification = {
  id: string;
  kind: "Market" | "Observer" | "Account";
  title: string;
  body: string;
  marketId?: string;
  createdAt: string;
};

export type MarketUpdate =
  | { type: "market.probability"; marketId: string; outcomeId: string; probability: number; recordedAt: string }
  | { type: "market.count"; marketId: string; count: number; rate: number; recordedAt: string }
  | { type: "market.status"; marketId: string; status: MarketStatus; recordedAt: string }
  | { type: "observer.status"; marketId: string; observerId: string; state: ObserverState; recordedAt: string };

export const marketTransitions: Record<MarketStatus, readonly MarketStatus[]> = {
  Scheduled: ["Open", "Invalid"],
  Open: ["Locked", "Invalid"],
  Locked: ["Observing", "Invalid"],
  Observing: ["Result proposed", "Invalid"],
  "Result proposed": ["Challenged", "Resolved", "Invalid"],
  Challenged: ["Resolved", "Invalid"],
  Resolved: [],
  Invalid: [],
};

export function canTransitionMarket(from: MarketStatus, to: MarketStatus) {
  return marketTransitions[from].includes(to);
}

export function isPositionableMarket(status: MarketStatus) {
  return status === "Open";
}

export function isTerminalMarket(status: MarketStatus) {
  return status === "Resolved" || status === "Invalid";
}
