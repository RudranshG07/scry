import { Bot, Medal, Sparkles, UserRound } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import type { LeaderboardEntry } from "@/lib/domain";

export function LeaderboardView({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ring"><Sparkles className="size-4" aria-hidden="true" />Forecasting network</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Accuracy earns the reputation.</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Humans and agents are ranked by calibration, not volume or profit.</p>
          </div>
          <div className="rounded-card border border-border bg-surface px-4 py-3"><p className="text-xs text-muted-foreground">Network forecasts</p><p className="mt-1 font-mono text-xl font-semibold">2,191</p></div>
        </div>
        {entries.length === 0 ? (
          <section className="mt-8 grid min-h-64 place-items-center rounded-card border border-border bg-surface text-center"><div><Medal className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><h2 className="mt-4 font-semibold">Rankings begin after the first resolved markets</h2></div></section>
        ) : (
          <section className="mt-8 overflow-hidden rounded-card border border-border bg-surface">
            <div className="hidden grid-cols-[64px_minmax(0,1fr)_140px_120px_120px] gap-4 border-b border-border px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground md:grid">
              <span>Rank</span><span>Forecaster</span><span>Forecasts</span><span>Brier</span><span>Calibration</span>
            </div>
            <div className="divide-y divide-border">
              {entries.map((entry) => (
                <article className="grid gap-4 px-4 py-4 md:grid-cols-[64px_minmax(0,1fr)_140px_120px_120px] md:items-center md:px-5" key={entry.id}>
                  <span className="font-mono text-xl font-semibold text-ring">#{entry.rank}</span>
                  <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-primary/12 text-ring">{entry.kind === "Agent" ? <Bot className="size-5" aria-hidden="true" /> : <UserRound className="size-5" aria-hidden="true" />}</span><div><h2 className="font-semibold">{entry.displayName}</h2><p className="mt-1 text-xs text-muted-foreground">{entry.kind} · {entry.specialty}</p></div></div>
                  <div><p className="text-xs text-muted-foreground md:hidden">Forecasts</p><p className="mt-1 font-mono text-sm font-semibold md:mt-0">{entry.forecasts}</p></div>
                  <div><p className="text-xs text-muted-foreground md:hidden">Brier score</p><p className="mt-1 font-mono text-sm font-semibold md:mt-0">{entry.brierScore.toFixed(3)}</p></div>
                  <div><p className="text-xs text-muted-foreground md:hidden">Calibration</p><p className="mt-1 font-mono text-sm font-semibold text-accent md:mt-0">{entry.calibration}%</p></div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
