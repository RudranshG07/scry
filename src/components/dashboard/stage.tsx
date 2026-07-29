"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { StreamPlayer } from "@/components/stream-player";
import type { ResolvedStream } from "@/app/api/streams/[marketId]/route";
import type { Market } from "@/lib/domain";
import { formatCount, formatLatency, formatRate } from "@/lib/format";
import { marketUnit, sourcesFor } from "@/lib/markets";
import { streamLatencyFor } from "@/lib/simulation";
import { marketPhase } from "@/lib/time";

export type FeedState = "ready" | "loading" | "error";

function LiveScene({ market }: { market: Market }) {
  return (
    <svg className="absolute inset-0 size-full" viewBox="0 0 900 520" role="img" aria-label={`Anonymized sensor view of ${market.location}`}>
      <defs>
        <linearGradient id="stage-road" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--muted)" />
          <stop offset="1" stopColor="var(--surface-raised)" />
        </linearGradient>
      </defs>
      <rect width="900" height="520" fill="var(--surface)" />
      <path d="M0 92H900V430H0Z" fill="url(#stage-road)" />
      <path d="M330 0H590V520H330Z" fill="var(--surface-soft)" />
      <path d="M0 255H900" stroke="var(--muted-foreground)" strokeWidth="3" strokeDasharray="22 28" opacity="0.5" />
      <path d="M460 0V520" stroke="var(--muted-foreground)" strokeWidth="3" strokeDasharray="22 28" opacity="0.45" />
      <path d="M0 90H900M0 432H900M328 0V520M592 0V520" stroke="var(--border)" strokeWidth="4" />
      <g className="vehicle-a"><rect x="80" y="178" width="70" height="34" rx="6" fill="var(--muted-foreground)" opacity="0.8" /></g>
      <g className="vehicle-b"><rect x="720" y="326" width="82" height="38" rx="6" fill="var(--accent)" opacity="0.7" /></g>
      <g className="vehicle-c"><rect x="384" y="60" width="38" height="78" rx="6" fill="var(--muted-foreground)" opacity="0.6" /></g>
      <path d="M264 74V446" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 8" />
      <circle cx="264" cy="255" r="4" fill="var(--accent)" />
    </svg>
  );
}

export function Stage({
  market,
  now,
  state,
  observedCount,
  currentRate,
  connected,
  onRefresh,
}: {
  market: Market;
  now: number;
  state: FeedState;
  observedCount: number | null;
  currentRate: number | null;
  connected: boolean;
  onRefresh: () => void;
}) {
  const phase = marketPhase(market, now);
  const latency = now === 0 ? null : streamLatencyFor(market, now);
  const settled = phase.status === "Resolved" || phase.status === "Invalid";
  const isRealFeed = sourcesFor(market.streamId).length > 0;
  const [activeSource, setActiveSource] = useState<ResolvedStream | null>(null);
  const handleSourceChange = useCallback((source: ResolvedStream | null) => setActiveSource(source), []);
  const isLiveSource = Boolean(activeSource?.live) && phase.isLive && connected;
  const unit = market.unit ?? marketUnit(market.id);

  return (
    <div>
    <div className="relative aspect-video w-full overflow-hidden border border-border bg-black">
      <StreamPlayer
        key={market.id}
        marketId={market.streamId}
        onSourceChange={handleSourceChange}
        label={`${market.city} ${market.location}`}
        fallback={<LiveScene market={market} />}
      />
      {!isRealFeed && <div className="stream-noise pointer-events-none absolute inset-0 opacity-50" />}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent" />

      {state === "loading" && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/85" aria-live="polite">
          <p className="text-sm text-white/60">Reconnecting to the edge stream…</p>
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/90 px-6 text-center" role="alert">
          <div className="max-w-sm">
            <CircleAlert className="mx-auto size-6 text-danger" aria-hidden="true" />
            <p className="mt-4 text-white">Stream connection interrupted</p>
            <p className="mt-2 text-sm leading-6 text-white/50">Market activity pauses until the source reconnects.</p>
            <button className="button-secondary mt-6" type="button" onClick={onRefresh}>Retry connection</button>
          </div>
        </div>
      )}

      <div className="absolute left-4 top-4 z-10">
        <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
          <span className={`size-1.5 rounded-full ${isLiveSource ? "signal-pulse bg-danger" : "bg-white/40"}`} aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-[0.16em] text-white">{isLiveSource ? "Live" : phase.status}</span>
        </span>
      </div>

      <div className="absolute bottom-4 right-4 z-10">
        <span className="flex items-center gap-3 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
          {latency !== null && connected && (
            <span className="font-mono text-[11px] tabular-nums text-white/50">{formatLatency(latency)}</span>
          )}
          <span className="text-[11px] text-white/50">{market.observers}/3</span>
          <button
            className="focus-ring -mr-1 grid size-6 place-items-center rounded-full text-white/50 transition-colors hover:text-white"
            type="button"
            onClick={onRefresh}
            disabled={state === "loading"}
            aria-label="Refresh stream"
          >
            <RefreshCw className={`size-3.5 ${state === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </span>
      </div>

      {phase.status === "Observing" && (
        <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-white/15">
          <div
            className="h-full bg-white transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.round(phase.observationProgress * 100)}%` }}
          />
        </div>
      )}
    </div>

    <div className="flex flex-wrap items-end gap-x-12 gap-y-4 border-x border-b border-border bg-surface px-5 py-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{settled ? "Final" : "Observed"}</p>
        <p className="mt-1 font-mono text-3xl tabular-nums">
          {observedCount === null ? "—" : formatCount(observedCount)}
          <span className="ml-2 text-xs text-muted-foreground">{unit}</span>
        </p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Rate</p>
        <p className="mt-1 font-mono text-xl tabular-nums">
          {currentRate === null ? "—" : formatRate(currentRate)}
          <span className="ml-1.5 text-xs text-muted-foreground">/min</span>
        </p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Baseline</p>
        <p className="mt-1 font-mono text-xl tabular-nums">
          {formatRate(market.baseline)}
          <span className="ml-1.5 text-xs text-muted-foreground">/min</span>
        </p>
      </div>
      {isRealFeed && (
        <p className="ml-auto max-w-64 text-right text-[11px] leading-4 text-muted-foreground">
          {activeSource ? `${activeSource.live ? "Live source" : "Fallback"}: ${activeSource.name}` : "Selecting a live source"}
          <br />
          {market.observers > 0
            ? `${market.observers} of 3 observers reporting`
            : "Waiting on an observer to report"}
        </p>
      )}
    </div>
    </div>
  );
}
