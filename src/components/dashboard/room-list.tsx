"use client";

import { useMemo } from "react";
import { useExperience } from "@/components/experience-provider";
import type { Market } from "@/lib/domain";
import { formatCompactUsd } from "@/lib/format";
import { categories, type Category } from "@/lib/markets";
import { countdownFor, marketPhase } from "@/lib/time";

export function RoomList({
  markets,
  now,
  selected,
  selectedCategory,
  onSelect,
  onCategory,
}: {
  markets: Market[];
  now: number;
  selected: string;
  selectedCategory: "All" | Category;
  onSelect: (id: string) => void;
  onCategory: (category: "All" | Category) => void;
}) {
  const { settings } = useExperience();

  const visible = useMemo(
    () => markets.filter((market) => selectedCategory === "All" || market.category === selectedCategory),
    [markets, selectedCategory],
  );

  return (
    <section className="border-t border-border" id="rooms" aria-label="All rooms">
      <div className="mx-auto w-full max-w-screen-2xl px-6 py-12 lg:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-6 border-b border-border pb-4">
          <h2 className="display text-3xl md:text-4xl">All rooms</h2>
          <div className="flex flex-wrap gap-6" aria-label="Market categories">
            {categories.map((category) => (
              <button
                className={`focus-ring rounded-control text-sm transition-colors ${
                  selectedCategory === category ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                type="button"
                key={category}
                aria-pressed={selectedCategory === category}
                onClick={() => onCategory(category)}
              >
                {category}
                {selectedCategory === category && <span className="mt-1 block h-px bg-foreground" />}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No {selectedCategory.toLowerCase()} market is scheduled right now.
          </p>
        ) : (
          <div>
            {visible.map((market) => {
              const phase = marketPhase(market, now);
              const active = market.id === selected;
              return (
                <button
                  key={market.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(market.id)}
                  className={`focus-ring grid w-full grid-cols-2 items-baseline gap-x-6 gap-y-2 border-b border-border py-5 text-left transition-colors hover:bg-surface md:grid-cols-[1fr_2.2fr_auto_auto_auto] md:gap-8 ${active ? "bg-surface" : ""}`}
                >
                  <span className="text-sm text-muted-foreground">
                    {market.city}
                    <span className="block text-xs text-muted-foreground/60">{market.location}</span>
                  </span>

                  <span className="col-span-2 text-sm leading-6 md:col-span-1 md:text-base">{market.question}</span>

                  <span className="font-mono text-2xl tabular-nums md:text-3xl">
                    {market.outcomes[0].probability}
                    <span className="text-sm text-muted-foreground">%</span>
                  </span>

                  <span className="text-right text-xs text-muted-foreground md:text-left">
                    <span className="block font-mono tabular-nums text-foreground">
                      {phase.remainingMs > 0 ? countdownFor(market, now) : "—"}
                    </span>
                    {phase.status}
                  </span>

                  <span className="text-right text-xs text-muted-foreground">
                    <span className="block font-mono tabular-nums text-foreground">
                      {settings.hidePoolValues ? "hidden" : formatCompactUsd(market.pool)}
                    </span>
                    pool
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
