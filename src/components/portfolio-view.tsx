"use client";

import { ArrowRight, CircleAlert, Coins, Crosshair, Inbox, LoaderCircle, RefreshCw, WalletCards } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { useWallet } from "@/components/wallet-provider";
import { useExperience } from "@/components/experience-provider";
import { scryApi } from "@/lib/api";
import type { Portfolio } from "@/lib/domain";
import { marketCatalog } from "@/lib/markets";

type PortfolioResult = {
  address: `0x${string}`;
  data: Portfolio | null;
  error: boolean;
};

export function PortfolioView() {
  const wallet = useWallet();
  const { settings } = useExperience();
  const [result, setResult] = useState<PortfolioResult | null>(null);

  useEffect(() => {
    if (!wallet.address || !wallet.isConnected) return;
    const address = wallet.address;
    const controller = new AbortController();
    void scryApi.getPortfolio(address, controller.signal)
      .then((data) => {
        setResult({ address, data, error: false });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ address, data: null, error: true });
      });
    return () => controller.abort();
  }, [wallet.address, wallet.isConnected]);

  const currentResult = wallet.address && result?.address === wallet.address ? result : null;
  const portfolio = currentResult?.data ?? null;
  const state = !wallet.isConnected
    ? "idle"
    : !currentResult
      ? "loading"
      : currentResult.error
        ? "error"
        : "success";

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Portfolio</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Positions, claims and refunds</h1></div>
          <Link className="button-secondary self-start sm:self-auto" href="/profile">Forecast profile<ArrowRight className="size-4" aria-hidden="true" /></Link>
        </div>

        <section className="mt-8 rounded-card border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center gap-2"><Crosshair className="size-5 text-ring" aria-hidden="true" /><h2 className="text-lg font-semibold">Your forecasts</h2></div>
          {settings.forecasts.length === 0 ? (
            <div className="py-10 text-center"><Inbox className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-semibold">No forecasts saved yet</p><p className="mt-2 text-sm text-muted-foreground">Free forecasts work without a wallet and stay on this device.</p><Link className="button-secondary mt-5" href="/">Make a forecast</Link></div>
          ) : (
            <div className="mt-4 grid gap-3">
              {settings.forecasts.map((forecast) => {
                const market = marketCatalog.find((item) => item.id === forecast.marketId);
                const outcome = market?.outcomes.find((item) => item.id === forecast.outcomeId);
                if (!market || !outcome) return null;
                return (
                  <article className="grid gap-4 rounded-card bg-surface-raised p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" key={forecast.marketId}>
                    <div><p className="text-xs font-semibold text-ring">{forecast.confidence}% confidence · {outcome.label}</p><h3 className="mt-2 text-sm font-semibold">{market.question}</h3><p className="mt-2 text-xs text-muted-foreground">{market.city} · Stored locally</p></div>
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
            <p className="mt-2 text-sm text-muted-foreground">The wallet is still connected. Retry the indexer request.</p>
            <button className="button-secondary mt-4" type="button" onClick={() => window.location.reload()}><RefreshCw className="size-4" aria-hidden="true" />Retry</button>
          </section>
        )}

        {wallet.isConnected && state === "success" && portfolio && (
          <>
            <section className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-card border border-border bg-surface p-5"><p className="text-xs text-muted-foreground">USDC balance</p><p className="mt-2 font-mono text-2xl font-semibold">{portfolio.balance.toFixed(2)}</p></div>
              <div className="rounded-card border border-border bg-surface p-5"><p className="text-xs text-muted-foreground">Open positions</p><p className="mt-2 font-mono text-2xl font-semibold">{portfolio.totalPositioned.toFixed(2)}</p></div>
              <div className="rounded-card border border-accent/30 bg-accent/8 p-5"><p className="text-xs text-muted-foreground">Claimable</p><p className="mt-2 font-mono text-2xl font-semibold text-accent">{portfolio.claimable.toFixed(2)}</p></div>
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
                      <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${position.state === "Claimable" ? "bg-accent/12 text-accent" : "bg-primary/12 text-ring"}`}>{position.state}</span><span className="text-xs text-muted-foreground">{position.outcomeLabel}</span></div><h3 className="mt-3 text-sm font-semibold">{position.question}</h3><p className="mt-2 font-mono text-xs text-muted-foreground">{position.amount.toFixed(2)} USDC positioned · {position.estimatedReturn.toFixed(2)} USDC estimated</p></div>
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
