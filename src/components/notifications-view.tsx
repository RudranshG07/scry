"use client";

import { Bell, BellRing, CheckCheck, CircleAlert, Radio, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useExperience } from "@/components/experience-provider";
import { SiteHeader } from "@/components/site-header";
import { useWallet } from "@/components/wallet-provider";
import { scryApi } from "@/lib/api";
import type { ScryNotification } from "@/lib/domain";
import { marketCatalog } from "@/lib/markets";

type NotificationResult = { attempt: number; data: ScryNotification[] | null; error: boolean };

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function NotificationsView() {
  const wallet = useWallet();
  const { settings, updateSettings } = useExperience();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<NotificationResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void scryApi.getNotifications(wallet.address ?? undefined, controller.signal)
      .then((data) => setResult({ attempt, data, error: false }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ attempt, data: null, error: true });
      });
    return () => controller.abort();
  }, [attempt, wallet.address]);

  const currentResult = result?.attempt === attempt ? result : null;
  const notifications = useMemo(() => {
    const reminderNotifications: ScryNotification[] = settings.reminders.flatMap((marketId) => {
      const market = marketCatalog.find((item) => item.id === marketId);
      if (!market) return [];
      return [{
        id: `reminder-${market.id}`,
        kind: "Market" as const,
        title: "Market reminder set",
        body: `${market.city} · ${market.question}`,
        marketId: market.id,
        createdAt: market.opensAt,
      }];
    });
    return [...reminderNotifications, ...(currentResult?.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [settings.reminders, currentResult]);
  const unread = notifications.filter((notification) => !settings.readNotifications.includes(notification.id));

  function markRead(id: string) {
    if (settings.readNotifications.includes(id)) return;
    updateSettings({ readNotifications: [...settings.readNotifications, id] });
  }

  function markAllRead() {
    updateSettings({ readNotifications: Array.from(new Set([...settings.readNotifications, ...notifications.map((notification) => notification.id)])) });
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-6 lg:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-ring">Signal center</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Stay close to the moments that matter.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Market reminders, observer health, and account updates appear here.</p></div>
          <button className="button-secondary" type="button" onClick={markAllRead} disabled={unread.length === 0}><CheckCheck className="size-4" aria-hidden="true" />Mark all read</button>
        </div>

        {!currentResult && <div className="mt-8 grid gap-3" aria-live="polite">{[0, 1, 2].map((item) => <div className="h-28 animate-pulse rounded-card bg-surface" key={item} />)}</div>}
        {currentResult?.error && <section className="mt-8 rounded-card border border-danger/30 bg-danger/8 p-5" role="alert"><CircleAlert className="size-5 text-danger" aria-hidden="true" /><h2 className="mt-3 font-semibold">Updates did not load</h2><p className="mt-2 text-sm text-muted-foreground">Retry the notification service request.</p><button className="button-secondary mt-4" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="size-4" aria-hidden="true" />Retry</button></section>}
        {currentResult?.data && notifications.length === 0 && <section className="mt-8 grid min-h-64 place-items-center rounded-card border border-border bg-surface text-center"><div><Bell className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><h2 className="mt-4 font-semibold">All quiet for now</h2><p className="mt-2 text-sm text-muted-foreground">Set a market reminder to see it here.</p><Link className="button-secondary mt-5" href="/markets">Browse schedule</Link></div></section>}
        {currentResult?.data && notifications.length > 0 && (
          <section className="mt-8 overflow-hidden rounded-card border border-border bg-surface" aria-label="Notifications">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5"><p className="text-sm font-semibold">{unread.length} unread</p><p className="text-xs text-muted-foreground">Stored locally in preview</p></div>
            <div className="divide-y divide-border">
              {notifications.map((notification) => {
                const read = settings.readNotifications.includes(notification.id);
                const Icon = notification.kind === "Observer" ? ShieldCheck : notification.kind === "Account" ? WalletCards : BellRing;
                return (
                  <article className={`grid gap-4 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start sm:px-5 ${read ? "bg-surface" : "bg-primary/6"}`} key={notification.id}>
                    <span className={`grid size-10 place-items-center rounded-full ${read ? "bg-surface-raised text-muted-foreground" : "bg-primary/12 text-ring"}`}><Icon className="size-5" aria-hidden="true" /></span>
                    <div><div className="flex flex-wrap items-baseline gap-2"><h2 className="font-semibold">{notification.title}</h2>{!read && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{notification.body}</p><time className="mt-2 block font-mono text-xs text-muted-foreground" dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time>{notification.marketId && <Link className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-ring" href={`/markets/${notification.marketId}`}>Open market</Link>}</div>
                    <button className="button-ghost justify-self-start" type="button" onClick={() => markRead(notification.id)} disabled={read}>{read ? "Read" : "Mark read"}</button>
                  </article>
                );
              })}
            </div>
          </section>
        )}
        <section className="mt-4 flex items-start gap-3 rounded-card border border-border bg-surface p-4"><Radio className="mt-0.5 size-5 shrink-0 text-ring" aria-hidden="true" /><div><h2 className="font-semibold">Browser notification delivery is not enabled</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">This preview keeps alerts inside Scry. Push delivery can be connected after notification permissions and backend delivery are ready.</p></div></section>
      </main>
    </div>
  );
}
