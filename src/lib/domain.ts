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
export type Category = "Traffic" | "Parking" | "Queues" | "Operations" | "Creators";

export type ClaimKind = "crossings" | "objects" | "phrase";

export type StreamSubmission = {
  sourceUrl: string;
  name: string;
  region?: string;
  timezone?: string;
  category?: Category;
  claim: { kind: ClaimKind; target: string; options?: Record<string, unknown> };
};

export type StreamStatus = {
  id: string;
  name: string;
  status: "Candidate" | "Qualified" | "Suspended" | "Retired";
  sourceUrl: string;
  claim: { kind: ClaimKind; target: string };
  reason?: string;
  threshold?: number;
  inspectedAt?: string;
};

export type MarketOutcome = {
  id: string;
  label: string;
  probability: number;
  returnRate: number;
  minimum?: number;
  maximum?: number;
};

export const deploymentStates = ["Requested", "Created", "Proposed", "Finalized", "Voided", "Unfunded", "Failed"] as const;

export type DeploymentState = (typeof deploymentStates)[number];

/** A market's contract on one chain. Each is a pool of its own: a stake on one
 * chain is paid only from what was staked on that chain. */
export type MarketDeployment = {
  chainId: number;
  contractAddress?: `0x${string}`;
  state: DeploymentState;
  staked?: Record<string, number>;
};

export type SettlementChain = {
  chainId: number;
  book: `0x${string}`;
  resolver: `0x${string}`;
};

export type Market = {
  id: string;
  key: string;
  streamId: string;
  category: Category;
  unit?: string;
  location: string;
  city: string;
  question: string;
  status: MarketStatus;
  countdown: string;
  pool: number;
  currentRate: number;
  baseline: number;
  observers: number;
  observersRequired: number;
  claim: { kind: ClaimKind; target: string; options?: Record<string, unknown> };
  deployments: MarketDeployment[];
  opensAt: string;
  locksAt: string;
  observationStartsAt: string;
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

export type PositionState = "Open" | "Claimable" | "Claimed" | "Lost" | "Refundable" | "Refunded";

export type Position = {
  id: string;
  marketId: string;
  key: string;
  chainId: number;
  contractAddress?: `0x${string}`;
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
  | { type: "market.count"; marketId: string; observerId?: string; count: number; rate: number; recordedAt: string }
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
