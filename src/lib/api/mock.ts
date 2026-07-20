import type { CreateRoomMessage, LeaderboardEntry, Portfolio, ProofOfObservation, RoomMessage, ScryNotification } from "@/lib/domain";
import { marketCatalog, markets } from "@/lib/markets";
import type { MarketQuery, MarketSubscription, ScryApi } from "@/lib/api/contract";

const proofs: Record<string, ProofOfObservation> = Object.fromEntries(
  marketCatalog.map((market) => [
    market.id,
    {
      marketId: market.id,
      streamId: market.streamId,
      status: market.status === "Observing" ? "Collecting" : market.status === "Resolved" ? "Final" : market.status === "Invalid" ? "Invalid" : "Proposed",
      observedValue: market.observedValue ?? (market.status === "Observing" ? null : 126),
      winningOutcomeId: market.winningOutcomeId ?? null,
      ruleHash: "0x6a91e14b7c332c1b8040f0bc9705dccb79d6a0ed8e40d02fd7db81cce8a5f07c",
      evidenceRoot: "0x4cf7512be0803e417ee357f858761adb49fbcc1a8b43a6e77c63ac0c08ce18a2",
      observationWindow: {
        opensAt: "2026-07-20T13:50:00.000Z",
        closesAt: "2026-07-20T14:00:00.000Z",
      },
      minimumUptime: 99,
      measuredUptime: 99.84,
      challengeEndsAt: "2026-07-20T14:10:00.000Z",
      observers: [
        {
          id: "observer-edge-01",
          name: "Edge log",
          role: "Edge",
          state: "Signed",
          modelVersion: "edge-agent/1.4.2",
          signature: "0x9f6c3a991ed6e429c8292e26bf93ae9187e8568f4ffb24b1a79d3a8f8d99072a",
        },
        {
          id: "observer-vision-01",
          name: "Vision primary",
          role: "Primary vision",
          state: "Signed",
          modelVersion: "counter/3.8.0",
          signature: "0x45a1c4a0a5d1e0f4041b64d1cb38d37d24f7a6bb4d9db4f50dc9ff043fd67f40",
        },
        {
          id: "observer-verify-01",
          name: "Independent verifier",
          role: "Independent verification",
          state: market.observers === 3 ? "Healthy" : "Reconnecting",
          modelVersion: "verifier/2.1.0",
        },
      ],
    },
  ]),
);

const leaderboard: LeaderboardEntry[] = [
  { rank: 1, id: "signal-fox", displayName: "Signal Fox", kind: "Human", specialty: "Traffic", forecasts: 284, brierScore: 0.116, calibration: 94 },
  { rank: 2, id: "atlas-flow", displayName: "Atlas Flow", kind: "Agent", specialty: "Operations", forecasts: 912, brierScore: 0.124, calibration: 92 },
  { rank: 3, id: "queue-theory", displayName: "Queue Theory", kind: "Human", specialty: "Queues", forecasts: 198, brierScore: 0.131, calibration: 91 },
  { rank: 4, id: "park-sense", displayName: "Park Sense", kind: "Agent", specialty: "Parking", forecasts: 641, brierScore: 0.138, calibration: 89 },
  { rank: 5, id: "monsoon-line", displayName: "Monsoon Line", kind: "Human", specialty: "Traffic", forecasts: 156, brierScore: 0.144, calibration: 87 },
];

const roomMessages: Record<string, RoomMessage[]> = Object.fromEntries(
  marketCatalog.map((market, index) => [
    market.id,
    [
      {
        id: `${market.id}-system`,
        marketId: market.id,
        author: "Scry observer",
        kind: "System",
        body: market.status === "Invalid" ? "The observation did not meet the published uptime rule." : "Stream health and observer clocks are within the published rule.",
        createdAt: `2026-07-20T13:${String(32 + index).padStart(2, "0")}:00.000Z`,
      },
      {
        id: `${market.id}-agent`,
        marketId: market.id,
        author: "Atlas Flow",
        kind: "Agent",
        body: market.forecast > 60 ? "Recent rate acceleration keeps the upper outcome favored." : "The current rate is close to baseline, so uncertainty remains high.",
        createdAt: `2026-07-20T13:${String(34 + index).padStart(2, "0")}:00.000Z`,
      },
    ],
  ]),
);

const notifications: ScryNotification[] = [
  {
    id: "observer-quorum-indore",
    kind: "Observer",
    title: "Observer quorum healthy",
    body: "All three observation paths are online for Campus Gate A.",
    marketId: "indore-gate-a",
    createdAt: "2026-07-20T13:46:00.000Z",
  },
  {
    id: "market-observing-bengaluru",
    kind: "Market",
    title: "Observation started",
    body: "The Orion Food Hall market is now counting its final window.",
    marketId: "bengaluru-food-hall",
    createdAt: "2026-07-20T13:41:00.000Z",
  },
  {
    id: "account-preview",
    kind: "Account",
    title: "Forecast preview active",
    body: "Free forecasts and reminders are stored on this device.",
    createdAt: "2026-07-20T13:30:00.000Z",
  },
];

function wait(duration = 180) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, duration));
}

export class MockScryApi implements ScryApi {
  async listMarkets(query: MarketQuery = {}) {
    if (typeof window !== "undefined") await wait();
    return marketCatalog.filter(
      (market) =>
        (!query.category || market.category === query.category) &&
        (!query.status || market.status === query.status),
    );
  }

  async getMarket(id: string) {
    if (typeof window !== "undefined") await wait(120);
    return marketCatalog.find((market) => market.id === id) ?? null;
  }

  async getProof(marketId: string) {
    if (typeof window !== "undefined") await wait(140);
    return proofs[marketId] ?? null;
  }

  async getPortfolio(address: `0x${string}`) {
    if (typeof window !== "undefined") await wait(320);
    const portfolio: Portfolio = {
      address,
      balance: 428.75,
      totalPositioned: 90,
      claimable: 39,
      positions: [
        {
          id: "position-1042",
          marketId: "indore-gate-a",
          question: markets[0].question,
          outcomeLabel: "Yes, above 180",
          amount: 25,
          estimatedReturn: 39,
          state: "Open",
          createdAt: "2026-07-20T13:44:00.000Z",
        },
        {
          id: "position-1038",
          marketId: "pune-ev-lot",
          question: markets[1].question,
          outcomeLabel: "No, 85% or below",
          amount: 65,
          estimatedReturn: 118.3,
          state: "Claimable",
          createdAt: "2026-07-20T12:18:00.000Z",
        },
      ],
    };
    return portfolio;
  }

  async getLeaderboard() {
    if (typeof window !== "undefined") await wait(240);
    return leaderboard;
  }

  async getRoomMessages(marketId: string) {
    if (typeof window !== "undefined") await wait(220);
    return roomMessages[marketId] ?? [];
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
    roomMessages[marketId] = [...(roomMessages[marketId] ?? []), message];
    return message;
  }

  async getNotifications() {
    if (typeof window !== "undefined") await wait(240);
    return notifications;
  }

  subscribeToMarket(marketId: string, subscription: MarketSubscription) {
    if (typeof window === "undefined") return () => undefined;
    const market = marketCatalog.find((item) => item.id === marketId);
    if (!market) {
      subscription.onError(new Error("Market subscription not found."));
      return () => undefined;
    }
    const timer = window.setInterval(() => {
      subscription.onEvent({
        type: "market.count",
        marketId,
        count: 126,
        rate: market.currentRate,
        recordedAt: new Date().toISOString(),
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }
}
