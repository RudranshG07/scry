"use client";

import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Crosshair,
  Gauge,
  LocateFixed,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { useExperience } from "@/components/experience-provider";
import { RoomActivity } from "@/components/room-activity";
import { StreamPlayer } from "@/components/stream-player";
import { useWallet } from "@/components/wallet-provider";
import { scryApi } from "@/lib/api";
import { isPositionableMarket, isTerminalMarket } from "@/lib/domain";
import {
  categories,
  Category,
  formatUsd,
  Market,
  marketCatalog,
  markets,
} from "@/lib/markets";

type FeedState = "ready" | "loading" | "error";
type PositionState = "idle" | "submitting" | "success" | "error";
type LiveSnapshot = { marketId: string; count: number; rate: number };

const statusTone: Record<Market["status"], string> = {
  Scheduled: "bg-primary/12 text-ring",
  Open: "bg-accent/12 text-accent",
  Locked: "bg-muted text-muted-foreground",
  Observing: "bg-warning/12 text-warning",
  "Result proposed": "bg-primary/12 text-ring",
  Challenged: "bg-danger/12 text-danger",
  Resolved: "bg-accent/12 text-accent",
  Invalid: "bg-danger/12 text-danger",
};

function StatusPill({ status }: Pick<Market, "status">) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ${statusTone[status]}`}>
      <span className={`size-1.5 rounded-full ${status === "Open" ? "signal-pulse bg-accent" : "bg-current"}`} />
      {status}
    </span>
  );
}

function MarketRail({
  selected,
  selectedCategory,
  onSelect,
  onCategory,
}: {
  selected: string;
  selectedCategory: "All" | Category;
  onSelect: (id: string) => void;
  onCategory: (category: "All" | Category) => void;
}) {
  const { settings } = useExperience();
  const visibleMarkets = useMemo(
    () => markets.filter((market) => selectedCategory === "All" || market.category === selectedCategory),
    [selectedCategory],
  );

  return (
    <aside className="w-full min-w-0 max-w-full overflow-hidden rounded-card border border-border bg-surface p-3 lg:col-span-2 xl:col-span-1" aria-label="Live markets">
      <div className="flex items-center justify-between px-2 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Discovery</p>
          <h2 className="mt-1 font-semibold">Live rooms</h2>
        </div>
        <span className="rounded-full bg-accent/12 px-2 py-1 font-mono text-xs text-accent">3 live</span>
      </div>
      <div className="mt-3 flex w-full max-w-full gap-2 overflow-x-auto pb-2 xl:grid xl:grid-cols-2" aria-label="Market categories">
        {categories.map((category) => (
          <button
            className={`focus-ring min-h-10 shrink-0 rounded-control px-3 text-xs font-semibold transition-colors ${
              selectedCategory === category
                ? "bg-foreground text-background"
                : "bg-surface-soft text-muted-foreground hover:text-foreground"
            }`}
            type="button"
            key={category}
            aria-pressed={selectedCategory === category}
            onClick={() => onCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>
      {visibleMarkets.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-border p-6 text-center">
          <Radio className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold">No rooms in this category</p>
          <button className="button-secondary mt-4" type="button" onClick={() => onCategory("All")}>Show all rooms</button>
        </div>
      ) : (
        <div className="mt-2 flex w-full max-w-full gap-2 overflow-x-auto xl:grid xl:overflow-visible">
          {visibleMarkets.map((market) => (
            <button
              key={market.id}
              type="button"
              onClick={() => onSelect(market.id)}
              aria-pressed={selected === market.id}
              className={`focus-ring min-w-64 rounded-card border p-4 text-left transition-colors xl:min-w-0 ${
                selected === market.id
                  ? "border-primary bg-primary/8"
                  : "border-transparent bg-surface-raised hover:border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <StatusPill status={market.status} />
                <span className="font-mono text-xs text-muted-foreground">{market.countdown}</span>
              </div>
              <p className="mt-3 text-xs font-medium text-muted-foreground">{market.city} · {market.location}</p>
              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5">{market.question}</p>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="font-mono text-xl font-semibold">{market.outcomes[0].probability}%</span>
                <span className="text-xs text-muted-foreground">{settings.hidePoolValues ? "Pool hidden" : `${formatUsd(market.pool)} pool`}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function LiveScene({ market }: { market: Market }) {
  return (
    <svg className="absolute inset-0 size-full" viewBox="0 0 900 520" role="img" aria-label={`Anonymized sensor view of ${market.location}`}>
      <defs>
        <linearGradient id="road" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--muted)" />
          <stop offset="1" stopColor="var(--surface-raised)" />
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.4" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <rect width="900" height="520" fill="var(--surface)" />
      <path d="M0 92H900V430H0Z" fill="url(#road)" />
      <path d="M330 0H590V520H330Z" fill="var(--surface-soft)" />
      <path d="M0 255H900" stroke="var(--muted-foreground)" strokeWidth="3" strokeDasharray="22 28" opacity="0.7" />
      <path d="M460 0V520" stroke="var(--muted-foreground)" strokeWidth="3" strokeDasharray="22 28" opacity="0.65" />
      <path d="M0 90H900M0 432H900M328 0V520M592 0V520" stroke="var(--border)" strokeWidth="4" />
      <rect x="72" y="124" width="168" height="84" rx="12" fill="url(#glow)" stroke="var(--primary)" strokeOpacity="0.35" />
      <rect x="662" y="312" width="142" height="74" rx="12" fill="url(#glow)" stroke="var(--primary)" strokeOpacity="0.35" />
      <g className="vehicle-a">
        <rect x="80" y="178" width="70" height="34" rx="8" fill="var(--primary-hover)" />
        <rect x="91" y="185" width="22" height="9" rx="3" fill="var(--foreground)" opacity="0.7" />
      </g>
      <g className="vehicle-b">
        <rect x="720" y="326" width="82" height="38" rx="9" fill="var(--accent)" />
        <rect x="758" y="333" width="28" height="10" rx="3" fill="var(--accent-foreground)" opacity="0.55" />
      </g>
      <g className="vehicle-c">
        <rect x="384" y="60" width="38" height="78" rx="9" fill="var(--warning)" />
        <rect x="392" y="72" width="22" height="26" rx="4" fill="var(--background)" opacity="0.5" />
      </g>
      <path d="M264 74V446" stroke="var(--accent)" strokeWidth="3" strokeDasharray="7 8" />
      <circle cx="264" cy="255" r="10" fill="var(--accent)" opacity="0.18" />
      <circle cx="264" cy="255" r="4" fill="var(--accent)" />
      <text x="280" y="248" fill="var(--accent)" fontSize="14" fontFamily="monospace">COUNT LINE 04</text>
      <text x="280" y="267" fill="var(--muted-foreground)" fontSize="12" fontFamily="monospace">TRACKING ACTIVE</text>
    </svg>
  );
}

function LiveFeed({
  market,
  state,
  observedCount,
  currentRate,
  onRefresh,
}: {
  market: Market;
  state: FeedState;
  observedCount: number;
  currentRate: number;
  onRefresh: () => void;
}) {
  return (
    <section id="live" className="min-w-0 overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusPill status={market.status} />
            <span className="truncate text-sm font-semibold">{market.city} · {market.location}</span>
          </div>
        </div>
        <button className="focus-ring grid size-10 shrink-0 place-items-center rounded-control text-muted-foreground hover:bg-surface-soft hover:text-foreground" type="button" onClick={onRefresh} disabled={state === "loading"} aria-label="Refresh stream" aria-busy={state === "loading"}>
          <RefreshCw className={`size-4 ${state === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      <div className="relative aspect-[16/10] min-h-80 overflow-hidden bg-background">
        {state === "loading" && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-background/92" aria-live="polite">
            <div className="w-full max-w-sm space-y-4 px-8">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-48 animate-pulse rounded-card bg-surface-soft" />
              <p className="text-center text-sm text-muted-foreground">Reconnecting to the edge stream…</p>
            </div>
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-background/95 px-6 text-center" role="alert">
            <div className="max-w-sm">
              <CircleAlert className="mx-auto size-7 text-danger" aria-hidden="true" />
              <p className="mt-3 font-semibold">Stream connection interrupted</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Market activity is paused until the authorized source reconnects.</p>
              <button className="button-secondary mt-5" type="button" onClick={onRefresh}>Retry connection</button>
            </div>
          </div>
        )}
        <StreamPlayer
          key={market.streamId}
          streamId={market.streamId}
          label={`${market.city} ${market.location}`}
          fallback={<LiveScene market={market} />}
        />
        <div className="stream-noise pointer-events-none absolute inset-0" />
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-control bg-background/75 px-3 py-2 text-xs font-semibold backdrop-blur-md">
          <Wifi className="size-4 text-accent" aria-hidden="true" />
          Anonymized · 820ms
        </div>
        <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
          <div className="rounded-control bg-background/78 px-3 py-2 backdrop-blur-md">
            <p className="text-xs text-muted-foreground">Current rate</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{currentRate.toFixed(1)}<span className="ml-1 text-xs font-normal text-muted-foreground">/ min</span></p>
          </div>
          <div className="rounded-control bg-background/78 px-3 py-2 text-right backdrop-blur-md">
            <p className="text-xs text-muted-foreground">Stream health</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-accent"><Check className="size-4" aria-hidden="true" />Qualified</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
        <Metric label="Observed" value={observedCount.toString()} suffix="events" />
        <Metric label="Baseline" value={market.baseline.toFixed(1)} suffix="/ min" />
        <Metric label="Lock in" value={market.countdown} suffix="mm:ss" />
      </div>
    </section>
  );
}

function Metric({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return (
    <div className="px-3 py-4 text-center sm:px-4 sm:text-left">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-base font-semibold tabular-nums sm:text-lg">{value}<span className="ml-1 text-xs font-normal text-muted-foreground">{suffix}</span></p>
    </div>
  );
}

function ProbabilityChart({ market }: { market: Market }) {
  const { settings } = useExperience();
  const points = market.trend
    .map((value, index) => `${(index / (market.trend.length - 1)) * 100},${100 - value}`)
    .join(" ");

  return (
    <section className="mt-4 rounded-card border border-border bg-surface p-4" aria-labelledby="consensus-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="consensus-heading" className="text-xs font-medium text-muted-foreground">Market consensus</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums">{market.outcomes[0].probability}%</span>
            <span className="text-xs font-semibold text-accent">+8.2%</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Pool</p>
          <p className="mt-1 font-mono text-sm font-semibold">{settings.hidePoolValues ? "Hidden" : formatUsd(market.pool)}</p>
        </div>
      </div>
      <div className="mt-4 h-24 rounded-control bg-surface-raised p-2">
        <svg className="size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Probability moved to ${market.outcomes[0].probability} percent`}>
          <defs>
            <linearGradient id={`chart-${market.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--primary)" stopOpacity="0.38" />
              <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polyline points={`0,100 ${points} 100,100`} fill={`url(#chart-${market.id})`} stroke="none" />
          <polyline points={points} fill="none" stroke="var(--primary-hover)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-control bg-primary/8 p-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Bot className="size-4 text-ring" aria-hidden="true" />Scry AI</p>
          <p className="mt-2 font-mono text-lg font-semibold">{market.forecast}%</p>
        </div>
        <div className="rounded-control bg-surface-raised p-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="size-4" aria-hidden="true" />Top forecasters</p>
          <p className="mt-2 font-mono text-lg font-semibold">{Math.min(96, market.forecast + 4)}%</p>
        </div>
      </div>
    </section>
  );
}

function PositionPanel({ market }: { market: Market }) {
  const wallet = useWallet();
  const { settings, isCoolingOff, saveForecast } = useExperience();
  const [mode, setMode] = useState<"forecast" | "position">("forecast");
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [stake, setStake] = useState("25");
  const [confidence, setConfidence] = useState("60");
  const [state, setState] = useState<PositionState>("idle");
  const [message, setMessage] = useState("");

  const selected = market.outcomes.find((outcome) => outcome.id === selectedOutcome);
  const numericStake = Number(stake);
  const expectedReturn = selected && Number.isFinite(numericStake) ? numericStake * selected.returnRate : 0;
  const effectiveLimit = Math.min(500, settings.dailyPositionLimit);
  const canSubmit = isPositionableMarket(market.status) && !isCoolingOff && selected && numericStake > 0 && numericStake <= effectiveLimit;
  const previousForecast = settings.forecasts.find((forecast) => forecast.marketId === market.id);

  function submitPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "forecast") {
      if (!selectedOutcome) {
        setState("error");
        setMessage("Choose the outcome you expect before saving your forecast.");
        return;
      }
      saveForecast({ marketId: market.id, outcomeId: selectedOutcome, confidence: Number(confidence) });
      setState("success");
      setMessage("Forecast saved on this device. You can update it until the market locks.");
      return;
    }
    if (!wallet.isConnected) {
      setState("error");
      setMessage("Connect a wallet before reviewing this position.");
      return;
    }
    if (!canSubmit) {
      setState("error");
      setMessage(isCoolingOff ? "Position previews are disabled during your cool-off." : `Choose an outcome and enter between 1 and ${effectiveLimit} USDC.`);
      return;
    }
    setState("submitting");
    setMessage("");
    window.setTimeout(() => {
      setState("success");
      setMessage("Position preview is ready for contract integration.");
    }, 750);
  }

  return (
    <aside className="min-w-0 rounded-card border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Make a call</p>
          <p className="mt-1 text-sm font-medium">Locks in <span className="font-mono text-warning">{market.countdown}</span></p>
        </div>
        <Crosshair className="size-5 text-ring" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-[-0.035em]">{market.question}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Resolution uses the fixed observation window and the published count-line rule.</p>
      <div className="mt-5 grid grid-cols-2 rounded-control border border-border bg-background p-1" role="group" aria-label="Participation mode">
        <button className={`focus-ring min-h-10 rounded-control text-xs font-semibold ${mode === "forecast" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} type="button" aria-pressed={mode === "forecast"} onClick={() => { setMode("forecast"); setState("idle"); setMessage(""); }}>Free forecast</button>
        <button className={`focus-ring min-h-10 rounded-control text-xs font-semibold ${mode === "position" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} type="button" aria-pressed={mode === "position"} onClick={() => { setMode("position"); setState("idle"); setMessage(""); }}>Position preview</button>
      </div>
      <form className="mt-6" onSubmit={submitPosition}>
        <fieldset disabled={!isPositionableMarket(market.status) || (mode === "position" && (isCoolingOff || effectiveLimit === 0)) || state === "submitting"}>
          <legend className="text-xs font-semibold text-muted-foreground">Choose an outcome</legend>
          <div className="mt-2 grid gap-2">
            {market.outcomes.map((outcome) => (
              <button
                key={outcome.id}
                type="button"
                className={`focus-ring flex min-h-16 items-center justify-between gap-3 rounded-control border px-4 text-left transition-colors ${
                  selectedOutcome === outcome.id
                    ? "border-primary bg-primary/12"
                    : "border-border bg-surface-raised hover:border-primary/60"
                }`}
                aria-pressed={selectedOutcome === outcome.id}
                onClick={() => {
                  setSelectedOutcome(outcome.id);
                  setState("idle");
                  setMessage("");
                }}
              >
                <span>
                  <span className="block text-sm font-semibold">{outcome.label}</span>
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">{mode === "forecast" ? "Forecast outcome" : `${outcome.returnRate.toFixed(2)}× return`}</span>
                </span>
                <span className="font-mono text-lg font-semibold">{outcome.probability}%</span>
              </button>
            ))}
          </div>
          {mode === "forecast" && (
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="confidence">Your confidence</label>
                <span className="font-mono text-sm font-semibold">{confidence}%</span>
              </div>
              <input
                id="confidence"
                className="focus-ring mt-3 h-10 w-full accent-[var(--primary)]"
                type="range"
                min="50"
                max="99"
                step="1"
                value={confidence}
                onChange={(event) => {
                  setConfidence(event.target.value);
                  setState("idle");
                  setMessage("");
                }}
              />
              <p className="text-xs leading-5 text-muted-foreground">Confidence contributes to calibration after the market resolves.</p>
              {previousForecast && <p className="mt-3 rounded-control bg-primary/8 p-3 text-xs text-ring">Saved forecast: {previousForecast.confidence}% confidence</p>}
            </div>
          )}
          {mode === "position" && <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="stake">Position size</label>
              <span className="text-xs text-muted-foreground">Max {effectiveLimit} USDC</span>
            </div>
            <div className="mt-2 flex min-h-12 items-center rounded-control border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
              <input
                id="stake"
                className="min-w-0 flex-1 bg-transparent font-mono text-base font-semibold outline-none"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={stake}
                onChange={(event) => {
                  setStake(event.target.value.replace(/[^0-9.]/g, ""));
                  setState("idle");
                  setMessage("");
                }}
                aria-describedby="stake-summary"
              />
              <span className="text-xs font-semibold text-muted-foreground">USDC</span>
            </div>
            <div id="stake-summary" className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Estimated return</span>
              <span className="font-mono font-semibold">{expectedReturn.toFixed(2)} USDC</span>
            </div>
          </div>}
        </fieldset>
        <button className="button-primary mt-5 w-full" type="submit" disabled={state === "submitting" || !isPositionableMarket(market.status) || (mode === "position" && (isCoolingOff || effectiveLimit === 0))} aria-busy={state === "submitting"}>
          {state === "submitting" ? (
            <><RefreshCw className="size-4 animate-spin" aria-hidden="true" />Preparing preview</>
          ) : (
            <>{mode === "forecast" ? "Save forecast" : "Review position"}<ArrowRight className="size-4" aria-hidden="true" /></>
          )}
        </button>
        {!isPositionableMarket(market.status) && (
          <p className="mt-3 rounded-control bg-warning/8 p-3 text-xs leading-5 text-warning">This market is {market.status.toLowerCase()}. New positions are unavailable.</p>
        )}
        {mode === "position" && isCoolingOff && <p className="mt-3 rounded-control bg-warning/8 p-3 text-xs leading-5 text-warning">Your 24-hour cool-off is active. Watching and free forecasting remain available.</p>}
        {mode === "position" && !isCoolingOff && effectiveLimit === 0 && <p className="mt-3 rounded-control bg-warning/8 p-3 text-xs leading-5 text-warning">Position previews are disabled by your limit.</p>}
        {message && (
          <div className={`mt-3 flex items-start gap-2 rounded-control p-3 text-xs leading-5 ${state === "error" ? "bg-danger/8 text-danger" : "bg-accent/8 text-accent"}`} role={state === "error" ? "alert" : "status"}>
            {state === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            {message}
          </div>
        )}
      </form>
      <div className="mt-5 flex items-center justify-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" aria-hidden="true" />
        {mode === "forecast" ? "Forecasts stay on this device" : "Preview mode · No funds are submitted"}
      </div>
    </aside>
  );
}

function ProofPanel({ market }: { market: Market }) {
  const observers = [
    { name: "Edge log", detail: "Clock + stream health", active: true },
    { name: "Vision primary", detail: "Detector v3.8", active: true },
    { name: "Independent verifier", detail: "Parallel count", active: market.observers === 3 },
  ];

  return (
    <section id="proof" className="mt-4 rounded-card border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Proof of Observation</p>
          <h2 className="mt-1 text-lg font-semibold">Independent signals agree</h2>
        </div>
        <span className="inline-flex min-h-10 items-center gap-2 self-start rounded-control bg-accent/10 px-3 text-xs font-semibold text-accent">
          <ShieldCheck className="size-4" aria-hidden="true" />
          {market.observers} of 3 online
        </span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {observers.map((observer, index) => (
          <div className="flex items-start gap-3 rounded-control bg-surface-raised p-4" key={observer.name}>
            <span className={`grid size-8 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold ${observer.active ? "bg-accent/12 text-accent" : "bg-warning/12 text-warning"}`}>{index + 1}</span>
            <div>
              <p className="text-sm font-semibold">{observer.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{observer.detail}</p>
              <p className={`mt-2 text-xs font-semibold ${observer.active ? "text-accent" : "text-warning"}`}>{observer.active ? "Healthy" : "Reconnecting"}</p>
            </div>
          </div>
        ))}
      </div>
      <Link className="focus-ring mt-4 flex min-h-10 items-center justify-between rounded-control px-2 text-sm font-semibold text-ring hover:bg-primary/8" href={`/proof/${market.id}`}>
        Inspect rule hash and evidence policy
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

function MarketGrid({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { settings } = useExperience();
  return (
    <section id="markets" className="mt-8 pb-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Across the network</p>
          <h2 className="mt-1 text-xl font-semibold">Markets moving now</h2>
        </div>
        <Link className="button-ghost hidden sm:inline-flex" href="/markets">View calendar<ArrowRight className="size-4" aria-hidden="true" /></Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {markets.map((market) => (
          <button
            key={market.id}
            type="button"
            onClick={() => onSelect(market.id)}
            className={`focus-ring rounded-card border p-4 text-left transition-colors ${market.id === selected ? "border-primary bg-primary/8" : "border-border bg-surface hover:bg-surface-raised"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{market.category}</span>
              <StatusPill status={market.status} />
            </div>
            <p className="mt-4 min-h-10 text-sm font-semibold leading-5">{market.question}</p>
            <div className="mt-5 flex items-baseline justify-between gap-3">
              <span className="font-mono text-2xl font-semibold">{market.outcomes[0].probability}%</span>
              <span className="text-xs text-muted-foreground">{settings.hidePoolValues ? "Pool hidden" : formatUsd(market.pool)}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ResultReveal({ market }: { market: Market }) {
  if (!isTerminalMarket(market.status)) return null;
  const winner = market.outcomes.find((outcome) => outcome.id === market.winningOutcomeId);
  const invalid = market.status === "Invalid";

  return (
    <section className={`mb-5 grid gap-5 rounded-card border p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${invalid ? "border-danger/30 bg-danger/8" : "border-accent/30 bg-accent/8"}`} aria-labelledby="result-heading">
      <div>
        <p className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] ${invalid ? "text-danger" : "text-accent"}`}>{invalid ? <CircleAlert className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}{invalid ? "Market invalidated" : "Result verified"}</p>
        <h2 id="result-heading" className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{invalid ? "Observation requirements were not met." : `${winner?.label ?? "Winning outcome"} resolved.`}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{invalid ? "The observer quorum fell below the published rule. Principal is refundable when settlement is connected." : `Final observed value: ${market.observedValue ?? "—"}. The evidence commitment and observer signatures are available for review.`}</p>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end"><Link className="button-secondary" href={`/proof/${market.id}`}>Inspect proof</Link><Link className="button-ghost" href="/markets?view=history">Market history</Link></div>
    </section>
  );
}

export function ScryDashboard({ initialMarketId = markets[0].id }: { initialMarketId?: string }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(initialMarketId);
  const [selectedCategory, setSelectedCategory] = useState<"All" | Category>("All");
  const [feedState, setFeedState] = useState<FeedState>("ready");
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(null);
  const market = marketCatalog.find((item) => item.id === selectedId) ?? markets[0];
  const currentSnapshot = liveSnapshot?.marketId === market.id ? liveSnapshot : null;

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

  useEffect(() => scryApi.subscribeToMarket(market.id, {
    onEvent: (event) => {
      if (event.type !== "market.count") return;
      setLiveSnapshot({ marketId: event.marketId, count: event.count, rate: event.rate });
    },
    onError: () => setFeedState("error"),
  }), [market.id]);

  function selectMarket(id: string) {
    setSelectedId(id);
    setFeedState("loading");
    window.setTimeout(() => setFeedState("ready"), 500);
    router.push(`/markets/${id}`);
  }

  function refreshFeed() {
    setFeedState("loading");
    window.setTimeout(() => setFeedState(navigator.onLine ? "ready" : "error"), 700);
  }

  return (
    <div id="top" className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto w-full min-w-0 max-w-screen-2xl px-4 py-5 md:px-6 lg:px-8">
        <section className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ring">
              <Sparkles className="size-4" aria-hidden="true" />
              Live physical-world forecasts
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">Watch the world live. Predict what happens next.</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-3 text-xs font-medium text-muted-foreground"><Activity className="size-4 text-accent" aria-hidden="true" />8 qualified streams</span>
            <Link className="focus-ring grid size-10 place-items-center rounded-control border border-border bg-surface text-muted-foreground hover:text-foreground" href="/notifications" aria-label="Open notifications"><Bell className="size-4" aria-hidden="true" /></Link>
          </div>
        </section>
        <ResultReveal market={market} />
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[250px_minmax(0,1fr)_350px]">
          <MarketRail selected={selectedId} selectedCategory={selectedCategory} onSelect={selectMarket} onCategory={setSelectedCategory} />
          <div className="min-w-0">
            <LiveFeed
              market={market}
              state={feedState}
              observedCount={currentSnapshot?.count ?? 126}
              currentRate={currentSnapshot?.rate ?? market.currentRate}
              onRefresh={refreshFeed}
            />
            <ProbabilityChart market={market} />
          </div>
          <PositionPanel key={market.id} market={market} />
        </div>
        <ProofPanel market={market} />
        <section id="proof-details" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card border border-border bg-surface p-4"><LocateFixed className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Rule commitment</p><p className="mt-1 font-mono text-sm font-semibold">0x6a91…f07c</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Clock3 className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Observation window</p><p className="mt-1 font-mono text-sm font-semibold">19:20–19:30 IST</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Gauge className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Minimum uptime</p><p className="mt-1 font-mono text-sm font-semibold">99.0%</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><ShieldCheck className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Challenge window</p><p className="mt-1 font-mono text-sm font-semibold">10 minutes</p></div>
        </section>
        <RoomActivity key={market.id} market={market} />
        <MarketGrid selected={selectedId} onSelect={selectMarket} />
      </main>
    </div>
  );
}
