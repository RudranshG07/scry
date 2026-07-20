"use client";

import { Bell, BellRing, CalendarDays, CircleAlert, Clock3, History, MapPin, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useExperience } from "@/components/experience-provider";
import { SiteHeader } from "@/components/site-header";
import { scryApi } from "@/lib/api";
import { isTerminalMarket, type Category, type Market, type MarketStatus } from "@/lib/domain";
import { categories, formatUsd } from "@/lib/markets";

type MarketResult = { attempt: number; data: Market[] | null; error: boolean };

const statusTone: Record<MarketStatus, string> = {
  Scheduled: "bg-primary/12 text-ring",
  Open: "bg-accent/12 text-accent",
  Locked: "bg-muted text-muted-foreground",
  Observing: "bg-warning/12 text-warning",
  "Result proposed": "bg-primary/12 text-ring",
  Challenged: "bg-danger/12 text-danger",
  Resolved: "bg-accent/12 text-accent",
  Invalid: "bg-danger/12 text-danger",
};

function formatSchedule(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function MarketCard({ market }: { market: Market }) {
  const { settings, toggleReminder } = useExperience();
  const reminded = settings.reminders.includes(market.id);
  const terminal = isTerminalMarket(market.status);
  const winningOutcome = market.outcomes.find((outcome) => outcome.id === market.winningOutcomeId);

  return (
    <article className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone[market.status]}`}>{market.status}</span>
          <span className="text-xs font-semibold text-muted-foreground">{market.category}</span>
        </div>
        {!terminal && (
          <button
            className={`focus-ring inline-flex min-h-10 items-center gap-2 rounded-control px-3 text-xs font-semibold ${reminded ? "bg-primary/12 text-ring" : "bg-surface-raised text-muted-foreground hover:text-foreground"}`}
            type="button"
            aria-pressed={reminded}
            onClick={() => toggleReminder(market.id)}
          >
            {reminded ? <BellRing className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}
            {reminded ? "Reminder set" : "Remind me"}
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
        <div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="size-4" aria-hidden="true" />{market.city} · {market.location}</p>
          <h2 className="mt-2 text-lg font-semibold leading-7">{market.question}</h2>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-4" aria-hidden="true" />{terminal ? `Resolved ${formatSchedule(market.resolvedAt ?? market.observationEndsAt)}` : `Locks ${formatSchedule(market.locksAt)}`}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {market.outcomes.map((outcome) => (
            <div className={`rounded-control p-3 ${outcome.id === market.winningOutcomeId ? "bg-accent/10" : "bg-surface-raised"}`} key={outcome.id}>
              <p className="line-clamp-2 text-xs text-muted-foreground">{outcome.label}</p>
              <p className={`mt-2 font-mono text-xl font-semibold ${outcome.id === market.winningOutcomeId ? "text-accent" : ""}`}>{outcome.probability}%</p>
            </div>
          ))}
        </div>
      </div>
      {terminal && (
        <div className={`mt-4 rounded-control p-3 text-sm ${market.status === "Invalid" ? "bg-danger/8 text-danger" : "bg-accent/8 text-accent"}`}>
          {market.status === "Invalid" ? "Observation was invalidated. Principal is refundable." : `Final observation: ${market.observedValue ?? "—"}${winningOutcome ? ` · ${winningOutcome.label} won` : ""}`}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">{settings.hidePoolValues ? "Pool hidden by your settings" : `${formatUsd(market.pool)} pool`}</p>
        <Link className="button-secondary" href={`/markets/${market.id}`}>{terminal ? "View result" : "Open live room"}</Link>
      </div>
    </article>
  );
}

export function MarketsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { settings } = useExperience();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<MarketResult | null>(null);
  const view = searchParams.get("view") === "history" ? "history" : "schedule";
  const search = searchParams.get("q") ?? "";
  const category = (searchParams.get("category") ?? "All") as "All" | Category;
  const status = searchParams.get("status") ?? "All";
  const remindersOnly = searchParams.get("reminders") === "1";

  useEffect(() => {
    const controller = new AbortController();
    void scryApi.listMarkets({ signal: controller.signal })
      .then((data) => setResult({ attempt, data, error: false }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ attempt, data: null, error: true });
      });
    return () => controller.abort();
  }, [attempt]);

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "All" || value === "0") params.delete(name);
    else params.set(name, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const currentResult = result?.attempt === attempt ? result : null;
  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (currentResult?.data ?? []).filter((market) => {
      const inView = view === "history" ? isTerminalMarket(market.status) : !isTerminalMarket(market.status);
      const matchesText = !normalized || `${market.question} ${market.city} ${market.location}`.toLowerCase().includes(normalized);
      const matchesCategory = category === "All" || market.category === category;
      const matchesStatus = status === "All" || market.status === status;
      const matchesReminder = !remindersOnly || settings.reminders.includes(market.id);
      return inView && matchesText && matchesCategory && matchesStatus && matchesReminder;
    });
  }, [currentResult, view, search, category, status, remindersOnly, settings.reminders]);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Market network</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Follow what is live and what comes next.</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Search qualified streams, set local reminders, and inspect completed observation records.</p>
          </div>
          <div className="grid grid-cols-2 rounded-control border border-border bg-surface p-1" role="group" aria-label="Market view">
            <button className={`focus-ring min-h-10 rounded-control px-4 text-sm font-semibold ${view === "schedule" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} type="button" aria-pressed={view === "schedule"} onClick={() => setParam("view", "schedule")}><CalendarDays className="mr-2 inline size-4" aria-hidden="true" />Schedule</button>
            <button className={`focus-ring min-h-10 rounded-control px-4 text-sm font-semibold ${view === "history" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} type="button" aria-pressed={view === "history"} onClick={() => setParam("view", "history")}><History className="mr-2 inline size-4" aria-hidden="true" />History</button>
          </div>
        </div>

        <section className="mt-8 rounded-card border border-border bg-surface p-4" aria-labelledby="filters-heading">
          <div className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-ring" aria-hidden="true" /><h2 id="filters-heading" className="text-sm font-semibold">Filter markets</h2></div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end">
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="market-search">Search markets</label>
              <div className="mt-2 flex min-h-11 items-center rounded-control border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
                <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                <input id="market-search" className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" type="search" autoComplete="off" placeholder="City, location, or question" value={search} onChange={(event) => setParam("q", event.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="market-category">Category</label>
              <select id="market-category" className="focus-ring mt-2 min-h-11 w-full rounded-control border border-border bg-background px-3 text-sm" value={category} onChange={(event) => setParam("category", event.target.value)}>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="market-status">Status</label>
              <select id="market-status" className="focus-ring mt-2 min-h-11 w-full rounded-control border border-border bg-background px-3 text-sm" value={status} onChange={(event) => setParam("status", event.target.value)}><option value="All">All</option>{(view === "history" ? ["Resolved", "Invalid"] : ["Scheduled", "Open", "Locked", "Observing", "Result proposed", "Challenged"]).map((item) => <option value={item} key={item}>{item}</option>)}</select>
            </div>
            <button className={`focus-ring min-h-11 rounded-control px-4 text-sm font-semibold ${remindersOnly ? "bg-primary/12 text-ring" : "border border-border bg-background text-muted-foreground"}`} type="button" aria-pressed={remindersOnly} onClick={() => setParam("reminders", remindersOnly ? "0" : "1")}><BellRing className="mr-2 inline size-4" aria-hidden="true" />Reminders</button>
          </div>
        </section>

        {!currentResult && <div className="mt-6 grid gap-3" aria-live="polite">{[0, 1, 2].map((item) => <div className="h-52 animate-pulse rounded-card bg-surface" key={item} />)}</div>}
        {currentResult?.error && <section className="mt-6 rounded-card border border-danger/30 bg-danger/8 p-5" role="alert"><CircleAlert className="size-5 text-danger" aria-hidden="true" /><h2 className="mt-3 font-semibold">Markets did not load</h2><p className="mt-2 text-sm text-muted-foreground">Retry the market service request.</p><button className="button-secondary mt-4" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />Retry</button></section>}
        {currentResult?.data && filtered.length === 0 && <section className="mt-6 grid min-h-64 place-items-center rounded-card border border-dashed border-border bg-surface px-6 text-center"><div><Search className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><h2 className="mt-4 font-semibold">No markets match these filters</h2><p className="mt-2 text-sm text-muted-foreground">Clear the search and filters to see the full catalogue.</p><button className="button-secondary mt-5" type="button" onClick={() => router.replace(`${pathname}?view=${view}`)}>Clear filters</button></div></section>}
        {currentResult?.data && filtered.length > 0 && <section className="mt-6 grid gap-4" aria-label={view === "history" ? "Market history" : "Market schedule"}>{filtered.map((market) => <MarketCard market={market} key={market.id} />)}</section>}
      </main>
    </div>
  );
}
