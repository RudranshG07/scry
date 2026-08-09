"use client";

import type { Market } from "@/lib/domain";
import { challengeWindowMs, formatSchedule } from "@/lib/time";

function Criterion({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-3">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm">{value}</dd>
    </div>
  );
}

export function Resolution({ market }: { market: Market }) {
  const unit = market.unit ?? "events";
  // The bar comes from the market's own outcomes, which the engine writes from
  // the threshold it measured for this camera. A build-time table had one
  // number for every stream and none at all for markets it did not know about.
  const bar = market.outcomes[0]?.label;

  return (
    <section aria-labelledby="resolution-heading">
      <h2 id="resolution-heading" className="border-b border-border pb-3 text-sm">
        How this resolves
      </h2>

      <dl className="mt-2 grid gap-x-10 sm:grid-cols-2">
        <Criterion
          label="Measured"
          value={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} crossing the published count line at ${market.location}.`}
        />
        <Criterion
          label="Threshold"
          value={bar ? `Resolves "${bar}" against the observed count.` : "Published with the market rule."}
        />
        <Criterion label="Observation window" value={`${formatSchedule(market.observationStartsAt)} to ${formatSchedule(market.observationEndsAt)}`} />
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
