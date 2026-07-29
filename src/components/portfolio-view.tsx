"use client";

import { ArrowRight, CircleAlert, Coins, Crosshair, Inbox, LoaderCircle, RefreshCw, WalletCards } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useWallet } from "@/components/wallet-provider";
import { useExperience } from "@/components/experience-provider";
import { usePortfolio } from "@/hooks/use-scry";
import { formatUsdc } from "@/lib/format";
import { marketDirectory, outcomeLabel } from "@/lib/markets";

const positionTone: Record<string, string> = {
  Claimable: "bg-accent/12 text-accent",
  Refundable: "bg-warning/12 text-warning",
  Claimed: "bg-muted text-muted-foreground",
  Refunded: "bg-muted text-muted-foreground",
  Open: "bg-primary/12 text-ring",
};

export function PortfolioView() {
  const wallet = useWallet();
  const { settings } = useExperience();
  const { data: portfolio, status, error, retry } = usePortfolio(wallet.isConnected ? wallet.address : null);
  const state = !wallet.isConnected ? "idle" : status;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Portfolio</p><h1 className="mt-2 display text-4xl">Positions, claims and refunds</h1></div>
          <Link className="button-secondary self-start sm:self-auto" href="/profile">Forecast profile<ArrowRight className="size-4" aria-hidden="true" /></Link>
        </div>

        <section className="mt-8 rounded-card border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center gap-2"><Crosshair className="size-5 text-ring" aria-hidden="true" /><h2 className="text-lg font-semibold">Your forecasts</h2></div>
          {settings.forecasts.length === 0 ? (
            <div className="py-10 text-center"><Inbox className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-semibold">No forecasts saved yet</p><p className="mt-2 text-sm text-muted-foreground">Free forecasts work without a wallet and stay on this device.</p><Link className="button-secondary mt-5" href="/">Make a forecast</Link></div>
          ) : (
            <div className="mt-4 grid gap-3">
              {settings.forecasts.map((forecast) => {
                const market = marketDirectory.get(forecast.marketId);
                if (!market) return null;
                return (
                  <article className="grid gap-4 rounded-card bg-surface-raised p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" key={forecast.marketId}>
                    <div><p className="text-xs font-semibold text-ring">{forecast.confidence}% confidence · {outcomeLabel(market.id, forecast.outcomeId)}</p><h3 className="mt-2 text-sm font-semibold">{market.question}</h3><p className="mt-2 text-xs text-muted-foreground">{market.city} · Stored locally</p></div>
                    <Link className="button-secondary" href={`/markets/${market.id}`}>View market<ArrowRight className="size-4" aria-hidden="true" /></Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {!wallet.isConnected && (
          <section className="mt-8 grid min-h-80 place-items-center rounded-card border border-border bg-surface px-6 text-center">
            <div className="max-w-sm">
              <WalletCards className="mx-auto size-8 text-ring" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-semibold">Connect your wallet</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Your positions are indexed by wallet address. Scry does not require a separate portfolio account.</p>
              <button className="button-primary mt-6" type="button" onClick={() => void wallet.connect()} disabled={wallet.status === "connecting"} aria-busy={wallet.status === "connecting"}>
                {wallet.status === "connecting" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <WalletCards className="size-4" aria-hidden="true" />}
                Connect wallet
              </button>
              {wallet.error && <p className="mt-3 text-xs text-danger" role="alert">{wallet.error}</p>}
            </div>
          </section>
        )}

        {wallet.isConnected && state === "loading" && (
          <div className="mt-8 grid gap-3" aria-live="polite">
            <div className="h-28 animate-pulse rounded-card bg-surface" />
            <div className="h-24 animate-pulse rounded-card bg-surface" />
            <div className="h-24 animate-pulse rounded-card bg-surface" />
          </div>
        )}

        {wallet.isConnected && state === "error" && (
          <section className="mt-8 rounded-card border border-danger/30 bg-danger/8 p-5" role="alert">
            <CircleAlert className="size-5 text-danger" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">Portfolio data did not load</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error?.message ?? "The wallet is still connected. Retry the indexer request."}</p>
            <button className="button-secondary mt-4" type="button" onClick={retry}><RefreshCw className="size-4" aria-hidden="true" />Retry</button>
          </section>
        )}

        {wallet.isConnected && state === "ready" && portfolio && (
          <>
            <section className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-card border border-border bg-surface p-5"><p className="text-xs text-muted-foreground">USDC balance</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{formatUsdc(portfolio.balance)}</p></div>
              <div className="rounded-card border border-border bg-surface p-5"><p className="text-xs text-muted-foreground">Total positioned</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{formatUsdc(portfolio.totalPositioned)}</p></div>
              <div className="rounded-card border border-accent/30 bg-accent/8 p-5"><p className="text-xs text-muted-foreground">Claimable</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-accent">{formatUsdc(portfolio.claimable)}</p></div>
            </section>
            {portfolio.positions.length === 0 ? (
              <section className="mt-4 grid min-h-64 place-items-center rounded-card border border-border bg-surface px-6 text-center">
                <div><Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><h2 className="mt-4 font-semibold">No positions yet</h2><p className="mt-2 text-sm text-muted-foreground">Choose a live market to make your first call.</p><Link className="button-primary mt-5" href="/">Browse live markets</Link></div>
              </section>
            ) : (
              <section className="mt-4 rounded-card border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-center gap-2"><Coins className="size-5 text-ring" aria-hidden="true" /><h2 className="text-lg font-semibold">Your positions</h2></div>
                <div className="mt-4 grid gap-3">
                  {portfolio.positions.map((position) => (
                    <article className="grid gap-4 rounded-card bg-surface-raised p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" key={position.id}>
                      <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${positionTone[position.state] ?? positionTone.Open}`}>{position.state}</span><span className="text-xs text-muted-foreground">{position.outcomeLabel}</span></div><h3 className="mt-3 text-sm font-semibold">{position.question}</h3><p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">{formatUsdc(position.amount)} positioned · {formatUsdc(position.estimatedReturn)} {position.state === "Refundable" ? "refundable" : "estimated"}</p></div>
                      <Link className="button-secondary" href={`/markets/${position.marketId}`}>View market<ArrowRight className="size-4" aria-hidden="true" /></Link>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
