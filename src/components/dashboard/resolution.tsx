"use client";

import type { Market } from "@/lib/domain";
import { formatCount } from "@/lib/format";
import { marketDirectory, marketUnit } from "@/lib/markets";
import { challengeWindowMs, formatSchedule, lockGraceMs } from "@/lib/time";

function Criterion({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-3">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm">{value}</dd>
    </div>
  );
}

export function Resolution({ market }: { market: Market }) {
  const entry = marketDirectory.get(market.id);
  const unit = marketUnit(market.id);
  const observationStartsAt = new Date(new Date(market.locksAt).getTime() + lockGraceMs).toISOString();

  return (
    <section aria-labelledby="resolution-heading">
      <h2 id="resolution-heading" className="border-b border-border pb-3 text-sm">
        How this resolves
      </h2>

      <dl className="mt-2 grid gap-x-10 sm:grid-cols-2">
        <Criterion
          label="Measured"
          value={
            entry
              ? `${unit.charAt(0).toUpperCase()}${unit.slice(1)} crossing the published count line at ${market.location}.`
              : `${unit} at ${market.location}.`
          }
        />
        <Criterion
          label="Threshold"
          value={entry ? `Resolves yes above ${formatCount(entry.threshold)} ${unit}.` : "Published with the market rule."}
        />
        <Criterion label="Observation window" value={`${formatSchedule(observationStartsAt)} to ${formatSchedule(market.observationEndsAt)}`} />
        <Criterion label="Quorum" value="Two of three independent observers must sign the same value." />
        <Criterion label="Minimum uptime" value="99.0% of the window, or the market invalidates and refunds." />
        <Criterion label="Challenge window" value={`${challengeWindowMs / 60_000} minutes after the result is proposed.`} />
      </dl>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        The rule and outcome bands are committed before the market opens and cannot change afterwards.
      </p>
    </section>
  );
}
