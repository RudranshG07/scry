"use client";

import { Eye, ShieldCheck, TimerReset, WifiOff } from "lucide-react";
import { FormEvent, ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Jurisdiction = "India" | "Outside India" | "Undisclosed";

export type LocalForecast = {
  marketId: string;
  outcomeId: string;
  confidence: number;
  submittedAt: string;
};

export type ExperienceSettings = {
  acknowledged: boolean;
  ageConfirmed: boolean;
  jurisdiction: Jurisdiction | null;
  dailyPositionLimit: number;
  sessionReminderMinutes: number;
  hidePoolValues: boolean;
  coolOffUntil: string | null;
  reminders: string[];
  forecasts: LocalForecast[];
  profile: {
    displayName: string;
    specialty: "Traffic" | "Parking" | "Queues" | "Operations";
  };
  readNotifications: string[];
  reactions: Record<string, "signal" | "watching" | "uncertain">;
};

type ExperienceContextValue = {
  settings: ExperienceSettings;
  isCoolingOff: boolean;
  updateSettings: (updates: Partial<ExperienceSettings>) => void;
  toggleReminder: (marketId: string) => void;
  saveForecast: (forecast: Omit<LocalForecast, "submittedAt">) => void;
  startCoolOff: () => void;
  resetAccess: () => void;
};

const storageKey = "scry-experience-v1";

const defaultSettings: ExperienceSettings = {
  acknowledged: false,
  ageConfirmed: false,
  jurisdiction: null,
  dailyPositionLimit: 250,
  sessionReminderMinutes: 30,
  hidePoolValues: false,
  coolOffUntil: null,
  reminders: [],
  forecasts: [],
  profile: {
    displayName: "Local Forecaster",
    specialty: "Traffic",
  },
  readNotifications: [],
  reactions: {},
};

const ExperienceContext = createContext<ExperienceContextValue | null>(null);

function saveSettings(settings: ExperienceSettings) {
  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}

function AccessGate({ onContinue }: { onContinue: (jurisdiction: Jurisdiction) => void }) {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | "">("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ageConfirmed || !jurisdiction) {
      setError("Confirm your age and select a region to continue.");
      return;
    }
    onContinue(jurisdiction);
  }

  return (
    <main className="signal-grid grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-xl rounded-card border border-border bg-surface p-5 sm:p-8" aria-labelledby="access-title">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full border border-primary/50 bg-primary/12">
            <Eye className="size-6 text-ring" aria-hidden="true" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-[-0.04em]">SCRY</p>
            <p className="text-xs text-muted-foreground">Forecast preview access</p>
          </div>
        </div>
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Before you enter</p>
          <h1 id="access-title" className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Watch and forecast responsibly.</h1>
          <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">This build is a product preview. It does not submit positions, move funds, or determine legal eligibility.</p>
        </div>
        <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
          <div>
            <label className="text-sm font-semibold" htmlFor="jurisdiction">Country or region</label>
            <select
              id="jurisdiction"
              className="focus-ring mt-2 min-h-12 w-full rounded-control border border-border bg-background px-3 text-sm"
              value={jurisdiction}
              onChange={(event) => {
                setJurisdiction(event.target.value as Jurisdiction | "");
                setError("");
              }}
              aria-invalid={Boolean(error) && !jurisdiction}
              aria-describedby="region-help"
            >
              <option value="">Select a region</option>
              <option value="India">India</option>
              <option value="Outside India">Outside India</option>
              <option value="Undisclosed">Prefer not to say</option>
            </select>
            <p id="region-help" className="mt-2 text-xs leading-5 text-muted-foreground">Region selection is stored only in this browser. Production access will require server-enforced eligibility checks.</p>
          </div>
          <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-border bg-surface-raised p-3 text-sm leading-6">
            <input
              className="mt-1 size-4 accent-[var(--primary)]"
              type="checkbox"
              checked={ageConfirmed}
              onChange={(event) => {
                setAgeConfirmed(event.target.checked);
                setError("");
              }}
              aria-describedby={error ? "access-error" : undefined}
            />
            <span>I confirm that I am at least 18 years old.</span>
          </label>
          {jurisdiction === "India" && (
            <div className="rounded-control border border-warning/30 bg-warning/8 p-3 text-xs leading-5 text-warning">
              India access remains forecast-only in this preview. Monetary participation is not enabled.
            </div>
          )}
          {error && <p id="access-error" className="text-sm text-danger" role="alert">{error}</p>}
          <button className="button-primary w-full" type="submit">Enter forecast preview<ShieldCheck className="size-4" aria-hidden="true" /></button>
        </form>
      </section>
    </main>
  );
}

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [sessionNotice, setSessionNotice] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const next = { ...defaultSettings, ...JSON.parse(stored) as Partial<ExperienceSettings> };
          if (next.coolOffUntil && new Date(next.coolOffUntil).getTime() <= Date.now()) next.coolOffUntil = null;
          setSettings(next);
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
      setOnline(window.navigator.onLine);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!ready || !settings.acknowledged || settings.sessionReminderMinutes === 0) return;
    const timer = window.setTimeout(() => setSessionNotice(true), settings.sessionReminderMinutes * 60_000);
    return () => window.clearTimeout(timer);
  }, [ready, settings.acknowledged, settings.sessionReminderMinutes]);

  const updateSettings = useCallback((updates: Partial<ExperienceSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...updates };
      saveSettings(next);
      return next;
    });
  }, []);

  const toggleReminder = useCallback((marketId: string) => {
    setSettings((current) => {
      const reminders = current.reminders.includes(marketId)
        ? current.reminders.filter((id) => id !== marketId)
        : [...current.reminders, marketId];
      const next = { ...current, reminders };
      saveSettings(next);
      return next;
    });
  }, []);

  const saveForecast = useCallback((forecast: Omit<LocalForecast, "submittedAt">) => {
    setSettings((current) => {
      const forecasts = [
        ...current.forecasts.filter((item) => item.marketId !== forecast.marketId),
        { ...forecast, submittedAt: new Date().toISOString() },
      ];
      const next = { ...current, forecasts };
      saveSettings(next);
      return next;
    });
  }, []);

  const startCoolOff = useCallback(() => {
    updateSettings({ coolOffUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
  }, [updateSettings]);

  const resetAccess = useCallback(() => {
    const next = {
      ...defaultSettings,
      reminders: settings.reminders,
      forecasts: settings.forecasts,
      profile: settings.profile,
      readNotifications: settings.readNotifications,
      reactions: settings.reactions,
    };
    saveSettings(next);
    setSettings(next);
  }, [settings.reminders, settings.forecasts, settings.profile, settings.readNotifications, settings.reactions]);

  const isCoolingOff = Boolean(settings.coolOffUntil);
  const value = useMemo(
    () => ({ settings, isCoolingOff, updateSettings, toggleReminder, saveForecast, startCoolOff, resetAccess }),
    [settings, isCoolingOff, updateSettings, toggleReminder, saveForecast, startCoolOff, resetAccess],
  );

  if (!ready) {
    return <main className="grid min-h-screen place-items-center" aria-live="polite"><div className="h-10 w-36 animate-pulse rounded-control bg-surface" /></main>;
  }

  if (!settings.acknowledged) {
    return <AccessGate onContinue={(jurisdiction) => updateSettings({ acknowledged: true, ageConfirmed: true, jurisdiction })} />;
  }

  return (
    <ExperienceContext.Provider value={value}>
      {!online && <div className="sticky top-0 z-50 flex min-h-10 items-center justify-center gap-2 bg-warning px-4 text-center text-xs font-semibold text-background" role="status"><WifiOff className="size-4" aria-hidden="true" />You are offline. Live counts and previews may be stale.</div>}
      {children}
      {sessionNotice && (
        <div className="fixed bottom-24 left-4 right-4 z-50 mx-auto max-w-md rounded-card border border-border bg-surface-raised p-4 shadow-xl md:bottom-6" role="status">
          <div className="flex items-start gap-3">
            <TimerReset className="mt-0.5 size-5 shrink-0 text-ring" aria-hidden="true" />
            <div className="min-w-0 flex-1"><p className="font-semibold">Session reminder</p><p className="mt-1 text-sm leading-5 text-muted-foreground">You have been exploring Scry for {settings.sessionReminderMinutes} minutes. Consider taking a break.</p></div>
          </div>
          <button className="button-secondary mt-4 w-full" type="button" onClick={() => setSessionNotice(false)}>Dismiss reminder</button>
        </div>
      )}
    </ExperienceContext.Provider>
  );
}

export function useExperience() {
  const value = useContext(ExperienceContext);
  if (!value) throw new Error("useExperience must be used inside ExperienceProvider.");
  return value;
}
