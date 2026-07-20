import type { CreateRoomMessage, LeaderboardEntry, Market, MarketUpdate, Portfolio, ProofOfObservation, RoomMessage, ScryNotification } from "@/lib/domain";
import type { MarketQuery, MarketSubscription, ScryApi } from "@/lib/api/contract";
import { ScryApiError } from "@/lib/api/contract";

export class HttpScryApi implements ScryApi {
  constructor(
    private readonly baseUrl: string,
    private readonly websocketUrl: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
    if (!response.ok) {
      throw new ScryApiError("Scry service request failed.", response.status);
    }
    return response.json() as Promise<T>;
  }

  listMarkets(query: MarketQuery = {}) {
    const params = new URLSearchParams();
    if (query.category) params.set("category", query.category);
    if (query.status) params.set("status", query.status);
    const search = params.size ? `?${params.toString()}` : "";
    return this.request<Market[]>(`/v1/markets${search}`, { signal: query.signal });
  }

  getMarket(id: string, signal?: AbortSignal) {
    return this.request<Market | null>(`/v1/markets/${encodeURIComponent(id)}`, { signal });
  }

  getProof(marketId: string, signal?: AbortSignal) {
    return this.request<ProofOfObservation | null>(`/v1/markets/${encodeURIComponent(marketId)}/proof`, { signal });
  }

  getPortfolio(address: `0x${string}`, signal?: AbortSignal) {
    return this.request<Portfolio>(`/v1/portfolio/${encodeURIComponent(address)}`, { signal });
  }

  getLeaderboard(signal?: AbortSignal) {
    return this.request<LeaderboardEntry[]>("/v1/leaderboard", { signal });
  }

  getRoomMessages(marketId: string, signal?: AbortSignal) {
    return this.request<RoomMessage[]>(`/v1/markets/${encodeURIComponent(marketId)}/messages`, { signal });
  }

  postRoomMessage(marketId: string, message: CreateRoomMessage, signal?: AbortSignal) {
    return this.request<RoomMessage>(`/v1/markets/${encodeURIComponent(marketId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal,
    });
  }

  getNotifications(address?: `0x${string}`, signal?: AbortSignal) {
    const search = address ? `?address=${encodeURIComponent(address)}` : "";
    return this.request<ScryNotification[]>(`/v1/notifications${search}`, { signal });
  }

  subscribeToMarket(marketId: string, subscription: MarketSubscription) {
    const socket = new WebSocket(`${this.websocketUrl}/v1/markets/${encodeURIComponent(marketId)}/stream`);
    socket.addEventListener("message", (event) => {
      try {
        subscription.onEvent(JSON.parse(event.data) as MarketUpdate);
      } catch {
        subscription.onError(new Error("Received an invalid market event."));
      }
    });
    socket.addEventListener("error", () => subscription.onError(new Error("Live market connection failed.")));
    return () => socket.close();
  }
}
