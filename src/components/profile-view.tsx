"use client";

import { ArrowRight, CheckCircle2, Crosshair, Medal, Save, Sparkles, Target, UserRound } from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";
import { useExperience } from "@/components/experience-provider";
import { SiteHeader } from "@/components/site-header";
import type { Category } from "@/lib/domain";
import { categories, marketCatalog } from "@/lib/markets";

export function ProfileView() {
  const { settings, updateSettings } = useExperience();
  const [displayName, setDisplayName] = useState(settings.profile.displayName);
  const [specialty, setSpecialty] = useState<Category>(settings.profile.specialty);
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  const nameRef = useRef<HTMLInputElement>(null);
  const forecasts = settings.forecasts;

  const stats = useMemo(() => {
    const averageConfidence = forecasts.length
      ? forecasts.reduce((total, forecast) => total + forecast.confidence, 0) / forecasts.length
      : 0;
    const coveredCategories = new Set(
      forecasts.map((forecast) => marketCatalog.find((market) => market.id === forecast.marketId)?.category).filter(Boolean),
    ).size;
    return {
      averageConfidence,
      coveredCategories,
      streak: Math.min(forecasts.length, 7),
    };
  }, [forecasts]);

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = displayName.trim();
    if (nextName.length < 2) {
      setState("error");
      nameRef.current?.focus();
      return;
    }
    updateSettings({ profile: { displayName: nextName, specialty } });
    setDisplayName(nextName);
    setState("success");
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ring"><Sparkles className="size-4" aria-hidden="true" />Forecast identity</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Build a record for being right for the right reasons.</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Your preview identity and forecasts stay on this device. Calibration scoring begins after connected markets resolve.</p>
          </div>
          <div className="flex items-center gap-4 rounded-card border border-border bg-surface p-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/12 text-ring"><UserRound className="size-6" aria-hidden="true" /></span>
            <div className="min-w-0"><p className="truncate font-semibold">{settings.profile.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{settings.profile.specialty} specialist · Preview profile</p></div>
          </div>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Forecast profile summary">
          <div className="rounded-card border border-border bg-surface p-4"><Crosshair className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Forecasts</p><p className="mt-1 font-mono text-2xl font-semibold">{forecasts.length}</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Target className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Average confidence</p><p className="mt-1 font-mono text-2xl font-semibold">{stats.averageConfidence.toFixed(0)}%</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Medal className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Forecast streak</p><p className="mt-1 font-mono text-2xl font-semibold">{stats.streak}</p></div>
          <div className="rounded-card border border-border bg-surface p-4"><Sparkles className="size-5 text-ring" aria-hidden="true" /><p className="mt-3 text-xs text-muted-foreground">Category coverage</p><p className="mt-1 font-mono text-2xl font-semibold">{stats.coveredCategories}/4</p></div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold">Profile settings</h2>
            <form className="mt-5 space-y-4" onSubmit={saveProfile} noValidate>
              <div>
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="display-name">Display name</label>
                <input
                  ref={nameRef}
                  id="display-name"
                  className="focus-ring mt-2 min-h-11 w-full rounded-control border border-border bg-background px-3 text-sm"
                  type="text"
                  autoComplete="nickname"
                  spellCheck={false}
                  maxLength={32}
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setState("idle");
                  }}
                  aria-invalid={state === "error"}
                  aria-describedby={state === "error" ? "display-name-error" : undefined}
                />
                {state === "error" && <p id="display-name-error" className="mt-2 text-xs text-danger" role="alert">Use at least two characters.</p>}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="specialty">Forecast specialty</label>
                <select id="specialty" className="focus-ring mt-2 min-h-11 w-full rounded-control border border-border bg-background px-3 text-sm" value={specialty} onChange={(event) => { setSpecialty(event.target.value as Category); setState("idle"); }}>{categories.filter((category) => category !== "All").map((category) => <option value={category} key={category}>{category}</option>)}</select>
              </div>
              <button className="button-primary w-full" type="submit"><Save className="size-4" aria-hidden="true" />Save profile</button>
              {state === "success" && <p className="flex items-center gap-2 text-xs text-accent" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />Profile saved on this device.</p>}
            </form>
          </section>

          <section className="rounded-card border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Forecast journal</p><h2 className="mt-1 text-lg font-semibold">Recent calls</h2></div><Link className="button-ghost" href="/leaderboard">View network ranks<ArrowRight className="size-4" aria-hidden="true" /></Link></div>
            {forecasts.length === 0 ? (
              <div className="grid min-h-64 place-items-center text-center"><div><Crosshair className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-semibold">No calls recorded yet</p><p className="mt-2 text-sm text-muted-foreground">Save a free forecast from any open live room.</p><Link className="button-secondary mt-5" href="/">Explore live rooms</Link></div></div>
            ) : (
              <div className="mt-4 grid gap-3">
                {[...forecasts].reverse().map((forecast) => {
                  const market = marketCatalog.find((item) => item.id === forecast.marketId);
                  const outcome = market?.outcomes.find((item) => item.id === forecast.outcomeId);
                  if (!market || !outcome) return null;
                  return <article className="grid gap-3 rounded-control bg-surface-raised p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={forecast.marketId}><div><p className="text-xs font-semibold text-ring">{forecast.confidence}% · {outcome.label}</p><h3 className="mt-2 text-sm font-semibold">{market.question}</h3><p className="mt-1 text-xs text-muted-foreground">{market.city} · {market.category}</p></div><Link className="button-secondary" href={`/markets/${market.id}`}>Open market</Link></article>;
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
