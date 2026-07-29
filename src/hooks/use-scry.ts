"use client";

import { useEffect, useState } from "react";
import { useAsync } from "@/hooks/use-async";
import { scryApi } from "@/lib/api";
import type { Market, MarketUpdate } from "@/lib/domain";

const marketRefreshMs = 20_000;

export function useMarkets() {
  return useAsync<Market[]>("markets", (signal) => scryApi.listMarkets({ signal }), {
    refreshMs: marketRefreshMs,
  });
}

export function useMarket(id: string) {
  return useAsync<Market | null>(`market:${id}`, (signal) => scryApi.getMarket(id, signal), {
    refreshMs: marketRefreshMs,
  });
}

export function useProof(marketId: string) {
  return useAsync(`proof:${marketId}`, (signal) => scryApi.getProof(marketId, signal), {
    refreshMs: marketRefreshMs,
  });
}

export function useLeaderboard() {
  return useAsync(`leaderboard`, (signal) => scryApi.getLeaderboard(signal));
}

export function usePortfolio(address: `0x${string}` | null) {
  return useAsync(
    `portfolio:${address ?? "none"}`,
    (signal) => scryApi.getPortfolio(address as `0x${string}`, signal),
    { enabled: Boolean(address) },
  );
}

export function useNotifications() {
  return useAsync("notifications", (signal) => scryApi.getNotifications(undefined, signal), {
    refreshMs: 60_000,
  });
}

export type MarketFeed = {
  count: number | null;
  rate: number | null;
  connected: boolean;
};

const emptyFeed: MarketFeed = { count: null, rate: null, connected: false };

export function useMarketFeed(marketId: string): MarketFeed {
  const [feed, setFeed] = useState<MarketFeed & { marketId: string }>({ ...emptyFeed, marketId });

  useEffect(() => {
    if (!marketId) return;
    return scryApi.subscribeToMarket(marketId, {
      onEvent: (event: MarketUpdate) => {
        if (event.type !== "market.count") return;
        setFeed({ marketId, count: event.count, rate: event.rate, connected: true });
      },
      onError: () => setFeed({ ...emptyFeed, marketId }),
    });
  }, [marketId]);

  return feed.marketId === marketId ? feed : emptyFeed;
}
