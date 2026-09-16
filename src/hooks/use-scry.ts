"use client";

import { useEffect, useState } from "react";
import { useAsync } from "@/hooks/use-async";
import { scryApi } from "@/lib/api";
import type { Market, MarketUpdate, SettlementChain, StreamStatus } from "@/lib/domain";

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

export function useSettlementChains() {
  return useAsync<SettlementChain[]>("chains", (signal) => scryApi.listChains(signal));
}

export function useStream(id: string | null) {
  return useAsync<StreamStatus>(`stream:${id ?? "none"}`, (signal) => scryApi.getStream(id as string, signal), {
    enabled: Boolean(id),
    refreshMs: 10_000,
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

export type ObserverCount = { observerId: string; count: number };

export type MarketFeed = {
  count: number | null;
  rate: number | null;
  observers: ObserverCount[];
  connected: boolean;
};

const emptyFeed: MarketFeed = { count: null, rate: null, observers: [], connected: false };

export function useMarketFeed(marketId: string): MarketFeed {
  const [feed, setFeed] = useState<MarketFeed & { marketId: string }>({ ...emptyFeed, marketId });

  useEffect(() => {
    if (!marketId) return;
    return scryApi.subscribeToMarket(marketId, {
      onEvent: (event: MarketUpdate) => {
        if (event.type !== "market.count") return;
        setFeed((current) => {
          const previous = current.marketId === marketId ? current : { ...emptyFeed, marketId };
          // Each observer counts the same window on its own, and seeing the two
          // numbers side by side is the point: they are what has to agree.
          const observers = event.observerId
            ? [
                ...previous.observers.filter((entry) => entry.observerId !== event.observerId),
                { observerId: event.observerId, count: event.count },
              ].sort((left, right) => left.observerId.localeCompare(right.observerId))
            : previous.observers;
          const highest = observers.reduce((top, entry) => Math.max(top, entry.count), 0);
          return {
            marketId,
            observers,
            count: observers.length > 0 ? highest : event.count,
            rate: event.rate || previous.rate,
            connected: true,
          };
        });
      },
      onError: () => setFeed({ ...emptyFeed, marketId }),
    });
  }, [marketId]);

  return feed.marketId === marketId ? feed : emptyFeed;
}
