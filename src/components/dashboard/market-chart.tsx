"use client";

import type { Market } from "@/lib/domain";
import { formatSignedPercent } from "@/lib/format";
import { formatSchedule } from "@/lib/time";

export function MarketChart({ market }: { market: Market }) {
  const trend = market.trend;
  if (trend.length < 2) return null;

  const leading = market.outcomes[0];
  const opening = trend[0];
  const delta = leading.probability - opening;
  const points = trend.map((value, index) => `${(index / (trend.length - 1)) * 100},${100 - value}`).join(" ");

  return (
    <section aria-label="Probability since the market opened">
      <div className="flex items-baseline justify-between gap-6 border-b border-border pb-3">
        <h2 className="text-sm">{leading.label}</h2>
        <p className="flex items-baseline gap-3">
          <span className="font-mono text-2xl tabular-nums">{leading.probability}%</span>
          <span className={`font-mono text-xs tabular-nums ${delta >= 0 ? "text-accent" : "text-danger"}`}>
            {formatSignedPercent(delta)}
          </span>
        </p>
      </div>

      <div className="relative mt-4 flex gap-4">
        <div className="flex w-8 shrink-0 flex-col justify-between py-0.5 text-right font-mono text-[10px] text-muted-foreground">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
        <div className="relative h-44 min-w-0 flex-1">
          <svg
            className="size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Moved from ${opening} to ${leading.probability} percent since opening`}
          >
            <defs>
              <linearGradient id={`fill-${market.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--foreground)" stopOpacity="0.14" />
                <stop offset="1" stopColor="var(--foreground)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="0" x2="100" y2="0" stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="100" x2="100" y2="100" stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <polyline points={`0,100 ${points} 100,100`} fill={`url(#fill-${market.id})`} stroke="none" />
            <polyline
              points={points}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: "100%", top: `${100 - leading.probability}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="ml-12 mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{formatSchedule(market.opensAt)}</span>
        <span>{formatSchedule(market.observationEndsAt)}</span>
      </div>
    </section>
  );
}
