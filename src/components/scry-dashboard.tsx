"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MarketChart } from "@/components/dashboard/market-chart";
import { ProofSheet } from "@/components/dashboard/proof-sheet";
import { Resolution } from "@/components/dashboard/resolution";
import { RoomList } from "@/components/dashboard/room-list";
import { Stage, type FeedState } from "@/components/dashboard/stage";
import { TradePanel } from "@/components/dashboard/trade-panel";
import { RoomActivity } from "@/components/room-activity";
import { SiteHeader } from "@/components/site-header";
import { useMarketFeed, useMarkets } from "@/hooks/use-scry";
import { useNow } from "@/lib/clock";
import type { Market } from "@/lib/domain";
import { formatCount } from "@/lib/format";
import { type Category } from "@/lib/markets";
import { marketPhase } from "@/lib/time";

function ResultBanner({ market, now }: { market: Market; now: number }) {
  const phase = marketPhase(market, now);
  if (phase.status !== "Resolved" && phase.status !== "Invalid") return null;

  const invalid = phase.status === "Invalid";
  const winner = market.outcomes.find((outcome) => outcome.id === market.winningOutcomeId);

  return (
    <div
      className={`border-b px-6 py-3 lg:px-8 ${invalid ? "border-danger/30 bg-danger/8" : "border-accent/30 bg-accent/8"}`}
      role="status"
    >
      <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-baseline justify-between gap-4">
        <p className={`text-sm ${invalid ? "text-danger" : "text-accent"}`}>
          {invalid
            ? "Observation did not meet the published rule. Every principal is refundable."
            : `${winner?.label ?? "Winning outcome"} resolved at ${market.observedValue === undefined ? "—" : `${formatCount(market.observedValue)} ${market.unit ?? "events"}`}.`}
        </p>
        <Link className="text-xs underline underline-offset-4 hover:no-underline" href={`/proof/${market.id}`}>
          Inspect the evidence
        </Link>
      </div>
    </div>
  );
}

export function ScryDashboard({ initialMarketId }: { initialMarketId?: string }) {
  const router = useRouter();
  const now = useNow();
  const { data: markets, status, error, retry } = useMarkets();
  const [selection, setSelection] = useState({ from: initialMarketId, id: initialMarketId ?? null });
  const [selectedCategory, setSelectedCategory] = useState<"All" | Category>("All");
  const [feedState, setFeedState] = useState<FeedState>("ready");

  const requestedId = selection.from === initialMarketId ? selection.id : initialMarketId ?? null;

  const market = useMemo(() => {
    if (!markets || markets.length === 0) return null;
    return markets.find((item) => item.id === requestedId) ?? markets[0];
  }, [markets, requestedId]);

  const feed = useMarketFeed(market?.id ?? "");

  useEffect(() => {
    function goOffline() {
      setFeedState("error");
    }
    function goOnline() {
      setFeedState("loading");
      window.setTimeout(() => setFeedState("ready"), 700);
    }
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  function selectMarket(id: string) {
    setSelection({ from: initialMarketId, id });
    setFeedState("loading");
    window.setTimeout(() => setFeedState("ready"), 400);
    router.push(`/markets/${id}`);
  }

  function refreshFeed() {
    setFeedState("loading");
    window.setTimeout(() => setFeedState(navigator.onLine ? "ready" : "error"), 700);
  }

  return (
    <div id="top" className="min-h-screen">
      <SiteHeader />

      {status === "loading" && (
        <div className="min-h-[560px] animate-pulse bg-surface lg:h-[68vh]" aria-busy="true" aria-label="Loading the live room" />
      )}

      {status === "error" && (
        <div className="grid min-h-[60vh] place-items-center px-6 text-center" role="alert">
          <div className="max-w-md">
            <CircleAlert className="mx-auto size-6 text-danger" aria-hidden="true" />
            <h1 className="display mt-5 text-3xl">Live markets did not load</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{error?.message ?? "The market service is unavailable."}</p>
            <button className="button-secondary mt-7" type="button" onClick={retry}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </button>
          </div>
        </div>
      )}

      {status === "ready" && !market && (
        <div className="grid min-h-[60vh] place-items-center px-6 text-center">
          <div className="max-w-md">
            <h1 className="display text-3xl">No markets are scheduled</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Qualified streams publish markets on a rolling schedule.
            </p>
            <Link className="button-secondary mt-7" href="/markets">Open the calendar</Link>
          </div>
        </div>
      )}

      {status === "ready" && market && markets && (
        <main>
          <ResultBanner market={market} now={now} />

          <div className="mx-auto w-full max-w-screen-2xl px-6 lg:px-8">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-4 pt-6 text-xs text-muted-foreground">
              <span>{market.category}</span>
              <span aria-hidden="true">·</span>
              <span>{market.city}</span>
              <span aria-hidden="true">·</span>
              <span>{market.location}</span>
            </div>

            <div className="grid gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
              <div className="min-w-0 space-y-10">
                <h1 className="display text-3xl md:text-4xl">{market.question}</h1>
                <Stage
                  market={market}
                  now={now}
                  state={feedState}
                  observedCount={feed.count}
                  currentRate={feed.rate ?? market.currentRate}
                  connected={feed.connected && feedState === "ready"}
                  onRefresh={refreshFeed}
                />
                <MarketChart market={market} />
                <Resolution market={market} />
                <ProofSheet key={`proof-${market.id}`} marketId={market.id} unit={market.unit ?? "events"} />
                <RoomActivity key={`room-${market.id}`} market={market} />
              </div>

              <TradePanel key={market.id} market={market} now={now} />
            </div>
          </div>

          <RoomList
            markets={markets}
            now={now}
            selected={market.id}
            selectedCategory={selectedCategory}
            onSelect={selectMarket}
            onCategory={setSelectedCategory}
          />
        </main>
      )}
    </div>
  );
}
