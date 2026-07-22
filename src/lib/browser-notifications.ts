import type { ScryNotification } from "@/lib/domain";

export const browserAlertStorageKey = "scry-browser-alerts-v1";
export const browserAlertPreferenceEvent = "scry-browser-alert-preference";

export type BrowserAlertPreference = {
  enabled: boolean;
  seenIds: string[];
};

const defaultPreference: BrowserAlertPreference = {
  enabled: false,
  seenIds: [],
};

export function parseBrowserAlertPreference(value: string | null): BrowserAlertPreference {
  if (!value) return defaultPreference;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultPreference;
    const candidate = parsed as Partial<BrowserAlertPreference>;
    if (typeof candidate.enabled !== "boolean" || !Array.isArray(candidate.seenIds)) return defaultPreference;
    const seenIds = candidate.seenIds.filter((id): id is string => typeof id === "string" && Boolean(id));
    return { enabled: candidate.enabled, seenIds: Array.from(new Set(seenIds)).slice(-250) };
  } catch {
    return defaultPreference;
  }
}

export function readBrowserAlertPreference(storage: Pick<Storage, "getItem">) {
  return parseBrowserAlertPreference(storage.getItem(browserAlertStorageKey));
}

export function writeBrowserAlertPreference(storage: Pick<Storage, "setItem">, preference: BrowserAlertPreference) {
  storage.setItem(browserAlertStorageKey, JSON.stringify({
    enabled: preference.enabled,
    seenIds: Array.from(new Set(preference.seenIds)).slice(-250),
  }));
}

export function unseenBrowserNotifications(notifications: ScryNotification[], seenIds: string[]) {
  const seen = new Set(seenIds);
  return notifications.filter((notification) => !seen.has(notification.id));
}

export function mergeBrowserNotificationIds(seenIds: string[], notifications: ScryNotification[]) {
  return Array.from(new Set([...seenIds, ...notifications.map((notification) => notification.id)])).slice(-250);
}

export function browserNotificationDestination(notification: ScryNotification) {
  return notification.marketId ? `/markets/${encodeURIComponent(notification.marketId)}` : "/notifications";
}
