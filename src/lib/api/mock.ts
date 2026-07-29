import type {
  CreateRoomMessage,
  LeaderboardEntry,
  Market,
  MarketStatus,
  Portfolio,
  Position,
  ProofOfObservation,
  RoomMessage,
  ScryNotification,
} from "@/lib/domain";
import { marketSeeds, marketUnit } from "@/lib/markets";
import { findMarketAt, listMarketsAt, liveCountFor, proofFor } from "@/lib/simulation";
import { marketPhase } from "@/lib/time";
import type { MarketQuery, MarketSubscription, ScryApi } from "@/lib/api/contract";

const leaderboard: LeaderboardEntry[] = [
  { rank: 1, id: "signal-fox", displayName: "Signal Fox", kind: "Human", specialty: "Traffic", forecasts: 284, brierScore: 0.116, calibration: 94 },
  { rank: 2, id: "atlas-flow", displayName: "Atlas Flow", kind: "Agent", specialty: "Operations", forecasts: 912, brierScore: 0.124, calibration: 92 },
  { rank: 3, id: "queue-theory", displayName: "Queue Theory", kind: "Human", specialty: "Queues", forecasts: 198, brierScore: 0.131, calibration: 91 },
  { rank: 4, id: "park-sense", displayName: "Park Sense", kind: "Agent", specialty: "Parking", forecasts: 641, brierScore: 0.138, calibration: 89 },
  { rank: 5, id: "monsoon-line", displayName: "Monsoon Line", kind: "Human", specialty: "Traffic", forecasts: 156, brierScore: 0.144, calibration: 87 },
  { rank: 6, id: "gate-oracle", displayName: "Gate Oracle", kind: "Agent", specialty: "Traffic", forecasts: 1204, brierScore: 0.149, calibration: 86 },
  { rank: 7, id: "dock-watch", displayName: "Dock Watch", kind: "Human", specialty: "Operations", forecasts: 143, brierScore: 0.157, calibration: 84 },
];

const postedMessages = new Map<string, RoomMessage[]>();

function seededMessages(market: Market): RoomMessage[] {
  const phase = marketPhase(market, Date.now());
  const opensAt = new Date(market.opensAt).getTime();
  const leader = market.outcomes[0];

  const entries: RoomMessage[] = [
    {
      id: `${market.id}-system`,
      marketId: market.id,
      author: "Scry observer",
      kind: "System",
      body:
        market.observers < 3
          ? "The independent verifier is offline. Resolution will invalidate if quorum is not restored."
          : "Stream health and observer clocks are inside the published rule.",
      createdAt: new Date(opensAt + 30_000).toISOString(),
    },
    {
      id: `${market.id}-agent`,
      marketId: market.id,
      author: "Atlas Flow",
      kind: "Agent",
      body:
        leader.probability > 60
          ? `Rate is running above baseline, so ${leader.label.toLowerCase()} stays favoured.`
          : "Current rate sits close to baseline. Uncertainty is still wide.",
      createdAt: new Date(opensAt + 90_000).toISOString(),
    },
  ];

  if (phase.status === "Observing") {
    entries.push({
      id: `${market.id}-observing`,
      marketId: market.id,
      author: "Scry observer",
      kind: "System",
      body: `Observation window is open. Counts are being recorded against the published count line.`,
      createdAt: new Date(new Date(market.locksAt).getTime() + 30_000).toISOString(),
    });
  }

  if (phase.isPending || phase.status === "Resolved") {
    entries.push({
      id: `${market.id}-proposed`,
      marketId: market.id,
      author: "Scry observer",
      kind: "System",
      body: `Result proposed at ${market.observedValue ?? 0} ${marketUnit(market.id)}. The challenge window is open.`,
      createdAt: market.observationEndsAt,
    });
  }

  return entries;
}

function buildNotifications(now: number): ScryNotification[] {
  const notifications: ScryNotification[] = [];

  for (const market of listMarketsAt(now)) {
    const phase = marketPhase(market, now);
    if (phase.status === "Observing") {
      notifications.push({
        id: `observing-${market.id}-${market.locksAt}`,
        kind: "Market",
        title: "Observation started",
        body: `${market.city} · ${market.location} is counting its final window.`,
        marketId: market.id,
        createdAt: market.locksAt,
      });
    }
    if (phase.isPending) {
      notifications.push({
        id: `proposed-${market.id}-${market.observationEndsAt}`,
        kind: "Market",
        title: "Result proposed",
        body: `${market.question} resolved at ${market.observedValue ?? 0} ${marketUnit(market.id)}.`,
        marketId: market.id,
        createdAt: market.observationEndsAt,
      });
    }
    if (market.observers < 3) {
      notifications.push({
        id: `quorum-${market.id}-${market.locksAt}`,
        kind: "Observer",
        title: "Observer quorum degraded",
        body: `Only ${market.observers} of 3 observers are reporting for ${market.location}.`,
        marketId: market.id,
        createdAt: market.locksAt,
      });
    }
  }

  notifications.push({
    id: "account-preview",
    kind: "Account",
    title: "Forecast preview active",
    body: "Free forecasts and reminders are stored on this device only.",
    createdAt: new Date(now - 30 * 60_000).toISOString(),
  });

  return notifications
    .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime())
    .slice(0, 12);
}

function positionState(market: Market, outcomeId: string): Position["state"] {
  if (market.status === "Invalid") return "Refundable";
  if (market.status === "Resolved") return market.winningOutcomeId === outcomeId ? "Claimable" : "Claimed";
  return "Open";
}

function buildPortfolio(address: `0x${string}`, now: number): Portfolio {
  const holdings = [
    { marketId: "long-beach-710", outcomeIndex: 0, amount: 25 },
    { marketId: "pune-ev-lot", outcomeIndex: 1, amount: 65 },
    { marketId: "santa-monica-10", outcomeIndex: 0, amount: 40 },
    { marketId: "kolkata-metro-gate", outcomeIndex: 1, amount: 30 },
  ];

  const positions: Position[] = [];
  for (const holding of holdings) {
    const market = findMarketAt(holding.marketId, now);
    if (!market) continue;
    const outcome = market.outcomes[holding.outcomeIndex];
    positions.push({
      id: `position-${holding.marketId}`,
      marketId: market.id,
      question: market.question,
      outcomeLabel: outcome.label,
      amount: holding.amount,
      estimatedReturn: Number((holding.amount * outcome.returnRate).toFixed(2)),
      state: positionState(market, outcome.id),
      createdAt: market.opensAt,
    });
  }

  const claimable = positions
    .filter((position) => position.state === "Claimable" || position.state === "Refundable")
    .reduce((total, position) => total + (position.state === "Refundable" ? position.amount : position.estimatedReturn), 0);

  return {
    address,
    balance: 428.75,
    totalPositioned: positions.reduce((total, position) => total + position.amount, 0),
    claimable: Number(claimable.toFixed(2)),
    positions,
  };
}

function wait(duration = 180) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, duration));
}

export class MockScryApi implements ScryApi {
  async listMarkets(query: MarketQuery = {}) {
    if (typeof window !== "undefined") await wait();
    return listMarketsAt(Date.now()).filter(
      (market) =>
        (!query.category || market.category === query.category) &&
        (!query.status || market.status === query.status),
    );
  }

  async getMarket(id: string) {
    if (typeof window !== "undefined") await wait(120);
    return findMarketAt(id, Date.now());
  }

  async getProof(marketId: string): Promise<ProofOfObservation | null> {
    if (typeof window !== "undefined") await wait(140);
    const now = Date.now();
    const market = findMarketAt(marketId, now);
    return market ? proofFor(market, now) : null;
  }

  async getPortfolio(address: `0x${string}`) {
    if (typeof window !== "undefined") await wait(320);
    return buildPortfolio(address, Date.now());
  }

  async getLeaderboard() {
    if (typeof window !== "undefined") await wait(240);
    return leaderboard;
  }

  async getRoomMessages(marketId: string) {
    if (typeof window !== "undefined") await wait(220);
    const market = findMarketAt(marketId, Date.now());
    if (!market) return [];
    return [...seededMessages(market), ...(postedMessages.get(marketId) ?? [])];
  }

  async postRoomMessage(marketId: string, input: CreateRoomMessage) {
    if (typeof window !== "undefined") await wait(260);
    const message: RoomMessage = {
      id: `${marketId}-${Date.now()}`,
      marketId,
      author: input.author,
      kind: "Human",
      body: input.body,
      createdAt: new Date().toISOString(),
    };
    postedMessages.set(marketId, [...(postedMessages.get(marketId) ?? []), message]);
    return message;
  }

  async getNotifications() {
    if (typeof window !== "undefined") await wait(240);
    return buildNotifications(Date.now());
  }

  subscribeToMarket(marketId: string, subscription: MarketSubscription) {
    if (typeof window === "undefined") return () => undefined;
    if (!marketSeeds.some((seed) => seed.id === marketId)) {
      subscription.onError(new Error("Market subscription not found."));
      return () => undefined;
    }

    let lastStatus: MarketStatus | null = null;
    let lastProbability: number | null = null;

    function emit() {
      const now = Date.now();
      const market = findMarketAt(marketId, now);
      if (!market) return;
      const recordedAt = new Date(now).toISOString();

      subscription.onEvent({
        type: "market.count",
        marketId,
        count: liveCountFor(market, now),
        rate: market.currentRate,
        recordedAt,
      });

      const leading = market.outcomes[0];
      if (leading.probability !== lastProbability) {
        lastProbability = leading.probability;
        subscription.onEvent({
          type: "market.probability",
          marketId,
          outcomeId: leading.id,
          probability: leading.probability,
          recordedAt,
        });
      }

      if (market.status !== lastStatus) {
        lastStatus = market.status;
        subscription.onEvent({ type: "market.status", marketId, status: market.status, recordedAt });
      }
    }

    emit();
    const timer = window.setInterval(emit, 2000);
    return () => window.clearInterval(timer);
  }
}
