"use client";

import Link from "next/link";
import type { Market } from "@/lib/domain";
import { useNow } from "@/lib/clock";
import { formatCompactUsd, formatCount } from "@/lib/format";
import { marketUnit } from "@/lib/markets";
import { countdownFor, marketPhase } from "@/lib/time";

export function LiveMarkets({ markets }: { markets: Market[] }) {
  const now = useNow();

  return (
    <section className="relative border-t border-white/10 bg-[#0a0608] px-6 py-24 md:px-12 md:py-32" id="live-markets">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="font-instrument max-w-2xl text-4xl leading-[1.05] tracking-tight text-white md:text-6xl">
            Every market is running right now.
          </h2>
          <p className="max-w-sm text-sm leading-6 text-white/50">
            Windows open and close on a rolling schedule. Nothing here is a mockup — these are the
            counts, pools and countdowns the rooms are showing.
          </p>
        </div>

        <div className="mt-14 border-t border-white/10">
          {markets.map((market) => {
            const phase = marketPhase(market, now);
            const leading = market.outcomes[0];
            return (
              <Link
                className="focus-ring group grid grid-cols-2 items-baseline gap-x-6 gap-y-3 border-b border-white/10 py-6 transition-colors hover:bg-white/[0.03] md:grid-cols-[1.1fr_2fr_auto_auto_auto] md:gap-8"
                href={`/markets/${market.id}`}
                key={market.id}
              >
                <span className="text-sm text-white/50">
                  {market.city}
                  <span className="block text-xs text-white/30">{market.location}</span>
                </span>

                <span className="col-span-2 text-base leading-6 text-white transition-colors group-hover:text-white md:col-span-1 md:text-lg">
                  {market.question}
                </span>

                <span className="font-mono text-3xl tabular-nums text-white md:text-4xl">
                  {leading.probability}
                  <span className="text-base text-white/40">%</span>
                </span>

                <span className="text-right text-xs text-white/40 md:text-left">
                  <span className="block font-mono tabular-nums text-white/70">
                    {phase.remainingMs > 0 ? countdownFor(market, now) : "—"}
                  </span>
                  {phase.countdownLabel}
                </span>

                <span className="text-right text-xs text-white/40">
                  <span className="block font-mono tabular-nums text-white/70">
                    {market.observedValue === undefined
                      ? formatCompactUsd(market.pool)
                      : `${formatCount(market.observedValue)}`}
                  </span>
                  {market.observedValue === undefined ? "pool" : marketUnit(market.id)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
