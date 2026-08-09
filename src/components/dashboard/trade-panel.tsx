"use client";

import { FormEvent, useState } from "react";

import { usePosition } from "@/hooks/use-position";
import { useExperience } from "@/components/experience-provider";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/components/wallet-provider";
import type { Market } from "@/lib/domain";
import { formatCompactUsd, formatHash, formatMultiplier, formatUsdc } from "@/lib/format";
import { countdownFor, marketPhase } from "@/lib/time";

type SubmitState = "idle" | "submitting" | "success" | "error";

const maximumPreviewStake = 500;

function SignalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

export function TradePanel({ market, now }: { market: Market; now: number }) {
  const wallet = useWallet();
  const { notify } = useToast();
  const { settings, isCoolingOff, saveForecast } = useExperience();
  const [mode, setMode] = useState<"forecast" | "position">("forecast");
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [stake, setStake] = useState("25");
  const [confidence, setConfidence] = useState("60");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const position = usePosition(market);

  const phase = marketPhase(market, now);
  const isOpen = phase.status === "Open";
  const leading = market.outcomes[0];
  const selected = market.outcomes.find((outcome) => outcome.id === selectedOutcome);
  const numericStake = Number(stake);
  const expectedReturn = selected && Number.isFinite(numericStake) ? numericStake * selected.returnRate : 0;
  const effectiveLimit = Math.min(maximumPreviewStake, settings.dailyPositionLimit);
  const previousForecast = settings.forecasts.find((forecast) => forecast.marketId === market.id);
  const positionBlocked = mode === "position" && (isCoolingOff || effectiveLimit === 0);
  const disabled = !isOpen || positionBlocked || state === "submitting";

  function resetFeedback() {
    setState("idle");
    setMessage("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "forecast") {
      if (!selectedOutcome) {
        setState("error");
        setMessage("Choose an outcome first.");
        return;
      }
      saveForecast({ marketId: market.id, outcomeId: selectedOutcome, confidence: Number(confidence) });
      setState("success");
      setMessage("Saved on this device until the market locks.");
      notify({ title: "Forecast saved", body: `${confidence}% on ${selected?.label ?? "your outcome"}.`, tone: "success" });
      return;
    }

    if (!wallet.isConnected) {
      setState("error");
      setMessage("Connect a wallet to review this position.");
      notify({ title: "Wallet not connected", body: "Connect a Base wallet to review a position.", tone: "warning" });
      return;
    }
    if (!selected || !(numericStake > 0) || numericStake > effectiveLimit) {
      setState("error");
      setMessage(`Choose an outcome and enter 1–${effectiveLimit} USDC.`);
      return;
    }

    if (!position.settles) {
      setState("error");
      setMessage("This market has no contract yet, so a position would move nothing.");
      notify({ title: "Not deployed", body: "This market is not on chain yet. No funds moved.", tone: "info" });
      return;
    }

    if (!wallet.signedInAs) {
      setState("error");
      setMessage("Sign in with your wallet first so this position is tied to you.");
      return;
    }

    setState("submitting");
    setMessage("");
    void position.take(selected.id, stake).then(() => {
      setState("idle");
    });
  }

  return (
    <aside className="lg:sticky lg:top-20" aria-label="Make a call">
      <div className="border border-border bg-surface">
        <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{leading.label}</p>
            <p className="mt-1 font-mono text-4xl tabular-nums">
              {leading.probability}
              <span className="text-lg text-muted-foreground">%</span>
            </p>
          </div>
          {phase.remainingMs > 0 && (
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{phase.countdownLabel}</p>
              <p className="mt-1 font-mono text-lg tabular-nums text-warning">{countdownFor(market, now)}</p>
            </div>
          )}
        </div>

        <form onSubmit={submit} className="px-5 py-5">
          <div className="flex gap-5" role="group" aria-label="Participation mode">
            {(["forecast", "position"] as const).map((option) => (
              <button
                className={`focus-ring rounded-control text-xs transition-colors ${mode === option ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                type="button"
                key={option}
                aria-pressed={mode === option}
                onClick={() => { setMode(option); resetFeedback(); }}
              >
                {option === "forecast" ? "Free forecast" : "Position preview"}
                {mode === option && <span className="mt-1 block h-px bg-foreground" />}
              </button>
            ))}
          </div>

          <fieldset disabled={disabled} className="mt-5">
            <legend className="sr-only">Choose an outcome</legend>
            <div className="grid gap-2">
              {market.outcomes.map((outcome) => {
                const active = selectedOutcome === outcome.id;
                const won = market.winningOutcomeId === outcome.id;
                return (
                  <button
                    key={outcome.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setSelectedOutcome(outcome.id); resetFeedback(); }}
                    className={`focus-ring relative flex min-h-14 items-center justify-between gap-3 overflow-hidden border px-4 text-left transition-colors ${
                      active ? "border-foreground" : "border-border hover:border-muted-foreground"
                    }`}
                  >
                    <span
                      className={`absolute inset-y-0 left-0 -z-10 ${won ? "bg-accent/12" : active ? "bg-primary/10" : "bg-surface-raised"}`}
                      style={{ width: `${outcome.probability}%` }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{outcome.label}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {formatMultiplier(outcome.returnRate)}
                        {won && <span className="ml-1.5 text-accent">resolved</span>}
                      </span>
                    </span>
                    <span className="font-mono text-2xl tabular-nums">{outcome.probability}%</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              {mode === "forecast" ? (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground" htmlFor="confidence">Confidence</label>
                    <span className="font-mono text-lg tabular-nums">{confidence}%</span>
                  </div>
                  <input
                    id="confidence"
                    className="focus-ring mt-3 h-8 w-full accent-[var(--primary)]"
                    type="range"
                    min="50"
                    max="99"
                    step="1"
                    value={confidence}
                    onChange={(event) => { setConfidence(event.target.value); resetFeedback(); }}
                  />
                  {previousForecast && <p className="text-xs text-ring">Saved earlier at {previousForecast.confidence}%</p>}
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground" htmlFor="stake">Amount</label>
                    <span className="text-xs text-muted-foreground">max {effectiveLimit}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2 border-b border-border pb-2 focus-within:border-foreground">
                    <input
                      id="stake"
                      className="min-w-0 flex-1 bg-transparent font-mono text-2xl tabular-nums outline-none"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={stake}
                      onChange={(event) => { setStake(event.target.value.replace(/[^0-9.]/g, "")); resetFeedback(); }}
                      aria-describedby="stake-return"
                    />
                    <span className="text-xs text-muted-foreground">USDC</span>
                  </div>
                  <p id="stake-return" className="mt-2 flex items-baseline justify-between gap-4 text-xs">
                    <span className="text-muted-foreground">Estimated return</span>
                    <span className="font-mono tabular-nums text-accent">{formatUsdc(expectedReturn)}</span>
                  </p>
                </>
              )}
            </div>
          </fieldset>

          <button className="button-primary mt-5 w-full" type="submit" disabled={disabled} aria-busy={state === "submitting"}>
            {position.state.stage === "approving"
              ? "Approving USDC"
              : position.state.stage === "depositing"
                ? "Confirm in wallet"
                : mode === "forecast"
                  ? "Save forecast"
                  : position.settles
                    ? "Take position"
                    : "Not deployed yet"}
          </button>

          {!isOpen && (
            <p className="mt-4 text-xs leading-5 text-warning">
              {phase.status} — new positions open with the next window.
            </p>
          )}
          {isOpen && positionBlocked && (
            <p className="mt-4 text-xs leading-5 text-warning">
              {isCoolingOff ? "Cool-off active. Free forecasting stays available." : "Positions disabled by your daily limit."}
            </p>
          )}
          {(message || position.state.message) && (
            <p
              className={`mt-4 text-xs leading-5 ${state === "error" || position.state.stage === "failed" ? "text-danger" : "text-accent"}`}
              role={state === "error" || position.state.stage === "failed" ? "alert" : "status"}
            >
              {position.state.message || message}
            </p>
          )}
          {position.state.depositHash && (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              {formatHash(position.state.depositHash)}
            </p>
          )}
        </form>

        <div className="border-t border-border px-5 pb-5">
          {/* "Scry AI" and "Forecasters" sat here as percentages. Nothing
              produced either number: the forecast column had no writer at all,
              and the consensus was derived from the market id. */}
          <SignalRow label="Pool" value={settings.hidePoolValues ? "hidden" : formatCompactUsd(market.pool)} />
          <SignalRow label="Observers" value={`${market.observers}`} />
          <p className="pt-4 text-[11px] leading-5 text-muted-foreground">
            {mode === "forecast" ? "Forecasts stay on this device." : "Preview only. No funds are submitted."}
          </p>
        </div>
      </div>
    </aside>
  );
}
