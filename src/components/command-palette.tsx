"use client";

import {
  CalendarDays,
  CornerDownLeft,
  LoaderCircle,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Trophy,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsync } from "@/hooks/use-async";
import { scryApi } from "@/lib/api";
import type { Market } from "@/lib/domain";
import { useNow } from "@/lib/clock";
import { countdownFor, marketPhase } from "@/lib/time";

type Command = {
  id: string;
  label: string;
  hint: string;
  group: "Markets" | "Navigate";
  href: string;
  icon: typeof Radio;
  keywords: string;
};

const destinations: Command[] = [
  { id: "nav-live", label: "Live room", hint: "Watch the active market", group: "Navigate", href: "/live", icon: Radio, keywords: "live room stream watch" },
  { id: "nav-markets", label: "Markets", hint: "Schedule and history", group: "Navigate", href: "/markets", icon: CalendarDays, keywords: "markets schedule history calendar" },
  { id: "nav-leaderboard", label: "Leaderboard", hint: "Calibrated forecasters", group: "Navigate", href: "/leaderboard", icon: Trophy, keywords: "leaderboard ranks forecasters calibration" },
  { id: "nav-portfolio", label: "Portfolio", hint: "Positions and claims", group: "Navigate", href: "/portfolio", icon: WalletCards, keywords: "portfolio positions claims balance" },
  { id: "nav-profile", label: "Profile", hint: "Your forecast record", group: "Navigate", href: "/profile", icon: UserRound, keywords: "profile account record" },
  { id: "nav-settings", label: "Controls", hint: "Limits and responsible use", group: "Navigate", href: "/settings", icon: Settings, keywords: "settings controls limits cool off" },
];

function marketCommands(markets: Market[], now: number): Command[] {
  return markets.map((market) => {
    const phase = marketPhase(market, now);
    return {
      id: `market-${market.id}`,
      label: market.question,
      hint: `${market.city} · ${market.location} · ${phase.status}${phase.remainingMs > 0 ? ` · ${countdownFor(market, now)}` : ""}`,
      group: "Markets" as const,
      href: `/markets/${market.id}`,
      icon: market.observers < 3 ? ShieldCheck : Radio,
      keywords: `${market.question} ${market.city} ${market.location} ${market.category} ${market.status}`.toLowerCase(),
    };
  });
}

export function CommandPalette() {
  const router = useRouter();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState({ query: "", index: 0 });
  const activeIndex = cursor.query === query ? cursor.index : 0;
  const setActiveIndex = useCallback(
    (update: (current: number) => number) => setCursor((current) => ({ query, index: update(current.query === query ? current.index : 0) })),
    [query],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const markets = useAsync<Market[]>("palette-markets", (signal) => scryApi.listMarkets({ signal }), {
    enabled: open,
  });

  const commands = useMemo(() => {
    const all = [...marketCommands(markets.data ?? [], now), ...destinations];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return all;
    return all.filter((command) => `${command.label} ${command.keywords}`.toLowerCase().includes(normalized));
  }, [markets.data, now, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor({ query: "", index: 0 });
    restoreRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => {
          if (!current) restoreRef.current = document.activeElement as HTMLElement | null;
          return !current;
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function run(command: Command) {
    close();
    router.push(command.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (commands.length === 0 ? 0 : (current + 1) % commands.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (commands.length === 0 ? 0 : (current - 1 + commands.length) % commands.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[activeIndex];
      if (command) run(command);
    }
  }

  if (!open) {
    return (
      <button
        className="focus-ring hidden min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-3 text-xs font-medium text-muted-foreground hover:text-foreground md:inline-flex"
        type="button"
        onClick={() => {
          restoreRef.current = document.activeElement as HTMLElement | null;
          setOpen(true);
        }}
      >
        <Search className="size-4" aria-hidden="true" />
        <span>Search markets</span>
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
      </button>
    );
  }

  let renderedGroup = "";

  return (
    <>
      <button
        className="fixed inset-0 z-[70] bg-background/70 backdrop-blur-sm"
        type="button"
        tabIndex={-1}
        aria-label="Close search"
        onClick={close}
      />
      <div className="fixed inset-x-0 top-[10vh] z-[71] mx-auto w-[calc(100%-2rem)] max-w-xl">
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-label="Search markets and pages">
          <div className="flex min-h-14 items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              type="text"
              role="combobox"
              autoComplete="off"
              placeholder="Search markets, cities, or pages"
              value={query}
              aria-expanded="true"
              aria-controls="command-list"
              aria-activedescendant={commands[activeIndex]?.id}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            {markets.status === "loading" && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
            <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">Esc</kbd>
          </div>

          <div ref={listRef} id="command-list" className="max-h-[52vh] overflow-y-auto p-2" role="listbox" aria-label="Results">
            {commands.length === 0 && (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                {markets.status === "loading" ? "Loading markets…" : `No results for “${query}”`}
              </p>
            )}
            {commands.map((command, index) => {
              const Icon = command.icon;
              const active = index === activeIndex;
              const showGroup = command.group !== renderedGroup;
              renderedGroup = command.group;
              return (
                <div key={command.id}>
                  {showGroup && (
                    <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{command.group}</p>
                  )}
                  <button
                    id={command.id}
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    className={`focus-ring flex w-full min-h-12 items-center gap-3 rounded-control px-3 text-left ${active ? "bg-primary/12" : "hover:bg-surface-raised"}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(() => index)}
                    onClick={() => run(command)}
                  >
                    <Icon className={`size-4 shrink-0 ${active ? "text-ring" : "text-muted-foreground"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{command.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{command.hint}</span>
                    </span>
                    {active && <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
