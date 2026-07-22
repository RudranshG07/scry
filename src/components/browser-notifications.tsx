"use client";

import { Bell, BellOff, BellRing, CircleAlert, LoaderCircle, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { scryApi } from "@/lib/api";
import {
  browserAlertPreferenceEvent,
  browserNotificationDestination,
  mergeBrowserNotificationIds,
  readBrowserAlertPreference,
  unseenBrowserNotifications,
  writeBrowserAlertPreference,
} from "@/lib/browser-notifications";
import type { ScryNotification } from "@/lib/domain";

type ControlState = "loading" | "idle" | "enabling" | "active" | "denied" | "unsupported" | "error";

function supportsBrowserAlerts() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

async function notificationWorker() {
  return navigator.serviceWorker.register("/scry-sw.js", { scope: "/" });
}

async function showBrowserAlert(notification: ScryNotification) {
  const registration = await notificationWorker();
  await registration.showNotification(notification.title, {
    body: notification.body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: notification.id,
    data: { url: browserNotificationDestination(notification) },
  });
}

function currentControlState(): ControlState {
  if (!supportsBrowserAlerts()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const preference = readBrowserAlertPreference(window.localStorage);
  return Notification.permission === "granted" && preference.enabled ? "active" : "idle";
}

export function BrowserNotificationDelivery() {
  useEffect(() => {
    let disposed = false;

    async function deliver() {
      if (disposed || !supportsBrowserAlerts() || Notification.permission !== "granted") return;
      const preference = readBrowserAlertPreference(window.localStorage);
      if (!preference.enabled) return;
      try {
        const notifications = await scryApi.getNotifications();
        if (disposed) return;
        const unseen = unseenBrowserNotifications(notifications, preference.seenIds).slice(-3);
        for (const notification of unseen) await showBrowserAlert(notification);
        writeBrowserAlertPreference(window.localStorage, {
          enabled: true,
          seenIds: mergeBrowserNotificationIds(preference.seenIds, notifications),
        });
      } catch {
        return;
      }
    }

    const refresh = () => void deliver();
    void deliver();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener(browserAlertPreferenceEvent, refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener(browserAlertPreferenceEvent, refresh);
    };
  }, []);

  return null;
}

export function BrowserNotificationControl() {
  const [state, setState] = useState<ControlState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setState(currentControlState()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function enable() {
    if (!supportsBrowserAlerts()) {
      setState("unsupported");
      return;
    }
    setState("enabling");
    setMessage("");
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission === "denied") {
        setState("denied");
        return;
      }
      if (permission !== "granted") {
        setState("idle");
        setMessage("Permission was not changed. You can enable alerts whenever you are ready.");
        return;
      }
      await notificationWorker();
      const notifications = await scryApi.getNotifications();
      writeBrowserAlertPreference(window.localStorage, {
        enabled: true,
        seenIds: notifications.map((notification) => notification.id),
      });
      setState("active");
      setMessage("Browser alerts are ready while Scry is open.");
      await showBrowserAlert({
        id: "scry-alerts-enabled",
        kind: "Account",
        title: "Scry alerts enabled",
        body: "Market and observer updates can now reach this browser.",
        createdAt: new Date().toISOString(),
      });
      window.dispatchEvent(new Event(browserAlertPreferenceEvent));
    } catch {
      setState("error");
      setMessage("Scry could not activate browser alerts. Try again.");
    }
  }

  function disable() {
    const preference = readBrowserAlertPreference(window.localStorage);
    writeBrowserAlertPreference(window.localStorage, { ...preference, enabled: false });
    setState("idle");
    setMessage("Browser alerts are paused on this device.");
    window.dispatchEvent(new Event(browserAlertPreferenceEvent));
  }

  async function sendTest() {
    setMessage("");
    try {
      await showBrowserAlert({
        id: `scry-alert-test-${Date.now()}`,
        kind: "Account",
        title: "Scry test alert",
        body: "Delivery is working on this device.",
        createdAt: new Date().toISOString(),
      });
      setMessage("Test alert sent.");
    } catch {
      setState("error");
      setMessage("The test alert could not be delivered. Try enabling alerts again.");
    }
  }

  const active = state === "active";
  const Icon = active ? BellRing : state === "denied" || state === "unsupported" ? BellOff : Bell;

  return (
    <section className="mt-4 rounded-card border border-border bg-surface p-4 sm:p-5" aria-labelledby="browser-alerts-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-full ${active ? "bg-accent/12 text-accent" : "bg-primary/12 text-ring"}`}>
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold" id="browser-alerts-title">Browser alerts</h2>
              {active && <span className="rounded-full bg-accent/12 px-2 py-1 text-xs font-semibold text-accent">Active</span>}
            </div>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              {state === "unsupported" && "This browser does not support notification delivery."}
              {state === "denied" && "Notification permission is blocked. Allow Scry in your browser settings, then refresh the status."}
              {(state === "loading" || state === "idle" || state === "enabling") && "Get market and observer updates outside the tab while Scry is open."}
              {active && "Market and observer updates can appear outside the tab while Scry is open."}
              {state === "error" && "Delivery needs attention before alerts can resume."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {state === "idle" && <button className="button-primary" type="button" onClick={() => void enable()}><BellRing className="size-4" aria-hidden="true" />Enable alerts</button>}
          {state === "enabling" && <button className="button-primary" type="button" disabled aria-busy="true"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Enabling</button>}
          {active && <button className="button-secondary" type="button" onClick={() => void sendTest()}><Send className="size-4" aria-hidden="true" />Send test</button>}
          {active && <button className="button-ghost" type="button" onClick={disable}>Turn off</button>}
          {(state === "denied" || state === "error") && <button className="button-secondary" type="button" onClick={() => setState(currentControlState())}><RefreshCw className="size-4" aria-hidden="true" />Refresh status</button>}
        </div>
      </div>

      {message && <p className={`mt-4 flex items-center gap-2 border-t border-border pt-4 text-xs ${state === "error" ? "text-danger" : "text-muted-foreground"}`} role="status">
        {state === "error" ? <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> : <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />}
        {message}
      </p>}
    </section>
  );
}
