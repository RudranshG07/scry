"use client";

import { CheckCircle2, EyeOff, Gauge, RotateCcw, ShieldAlert, TimerReset } from "lucide-react";
import { FormEvent, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { useExperience } from "@/components/experience-provider";

export function SettingsView() {
  const { settings, isCoolingOff, updateSettings, startCoolOff, resetAccess } = useExperience();
  const [limit, setLimit] = useState(settings.dailyPositionLimit.toString());
  const [sessionMinutes, setSessionMinutes] = useState(settings.sessionReminderMinutes.toString());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextLimit = Number(limit);
    const nextSession = Number(sessionMinutes);
    if (!Number.isFinite(nextLimit) || nextLimit < 0 || nextLimit > 500) {
      setError("Set a daily preview limit between 0 and 500 USDC.");
      setSaved(false);
      return;
    }
    if (![0, 15, 30, 60].includes(nextSession)) {
      setError("Choose a valid session reminder.");
      setSaved(false);
      return;
    }
    updateSettings({ dailyPositionLimit: nextLimit, sessionReminderMinutes: nextSession });
    setError("");
    setSaved(true);
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Responsible use</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Controls that stay in your hands.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">These preview settings are stored locally. Server-enforced limits and eligibility checks will replace them before monetary access exists.</p>
        </div>

        <form className="mt-8 grid gap-4 lg:grid-cols-2" onSubmit={save}>
          <section className="rounded-card border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-ring"><Gauge className="size-5" aria-hidden="true" /></span>
              <div><h2 className="font-semibold">Position preview limit</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Caps the amount you can prepare in a single position preview.</p></div>
            </div>
            <label className="mt-5 block text-sm font-semibold" htmlFor="daily-limit">Maximum per preview</label>
            <div className="mt-2 flex min-h-12 items-center rounded-control border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
              <input
                id="daily-limit"
                className="min-w-0 flex-1 bg-transparent font-mono outline-none"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={limit}
                onChange={(event) => {
                  setLimit(event.target.value.replace(/[^0-9.]/g, ""));
                  setSaved(false);
                  setError("");
                }}
                aria-invalid={Boolean(error)}
                aria-describedby="daily-limit-help"
              />
              <span className="text-xs font-semibold text-muted-foreground">USDC</span>
            </div>
            <p id="daily-limit-help" className="mt-2 text-xs text-muted-foreground">Enter 0 to disable position previews.</p>
          </section>

          <section className="rounded-card border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-ring"><TimerReset className="size-5" aria-hidden="true" /></span>
              <div><h2 className="font-semibold">Session reminder</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Get a gentle prompt after continuous use.</p></div>
            </div>
            <label className="mt-5 block text-sm font-semibold" htmlFor="session-reminder">Reminder interval</label>
            <select
              id="session-reminder"
              className="focus-ring mt-2 min-h-12 w-full rounded-control border border-border bg-background px-3 text-sm"
              value={sessionMinutes}
              onChange={(event) => {
                setSessionMinutes(event.target.value);
                setSaved(false);
              }}
            >
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every 60 minutes</option>
              <option value="0">Off</option>
            </select>
          </section>

          <section className="rounded-card border border-border bg-surface p-5 lg:col-span-2">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-ring"><EyeOff className="size-5" aria-hidden="true" /></span>
                <div><h2 className="font-semibold">Hide pool values</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Keep market probabilities visible while hiding USDC pool totals.</p></div>
              </div>
              <button
                className={`focus-ring min-h-11 min-w-24 rounded-control px-4 text-sm font-semibold ${settings.hidePoolValues ? "bg-primary text-primary-foreground" : "border border-border bg-surface-raised"}`}
                type="button"
                role="switch"
                aria-checked={settings.hidePoolValues}
                onClick={() => updateSettings({ hidePoolValues: !settings.hidePoolValues })}
              >
                {settings.hidePoolValues ? "Hidden" : "Visible"}
              </button>
            </div>
          </section>

          {error && <p className="text-sm text-danger lg:col-span-2" role="alert">{error}</p>}
          {saved && <p className="flex items-center gap-2 text-sm text-accent lg:col-span-2" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />Responsible-use controls saved.</p>}
          <button className="button-primary justify-self-start" type="submit">Save controls</button>
        </form>

        <section className="mt-8 rounded-card border border-danger/30 bg-danger/6 p-5">
          <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" /><div><h2 className="font-semibold">Take a 24-hour cool-off</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Cool-off disables new position previews on this browser. It cannot be cancelled early.</p></div></div>
          <button className="button-secondary mt-5" type="button" onClick={startCoolOff} disabled={isCoolingOff}>{isCoolingOff ? "Cool-off active" : "Start 24-hour cool-off"}</button>
        </section>

        <section className="mt-4 flex flex-col gap-4 rounded-card border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold">Access acknowledgement</h2><p className="mt-1 text-sm text-muted-foreground">Current region: {settings.jurisdiction}. Reset to review the access screen again.</p></div>
          <button className="button-ghost shrink-0" type="button" onClick={resetAccess}><RotateCcw className="size-4" aria-hidden="true" />Reset access</button>
        </section>
      </main>
    </div>
  );
}
