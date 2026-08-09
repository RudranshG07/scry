import type { Category } from "./domain.ts";

export type { Category, Market, MarketOutcome, MarketStatus } from "./domain.ts";

export const categories: Array<"All" | Category> = [
  "All",
  "Traffic",
  "Parking",
  "Queues",
  "Operations",
];

// Cameras belong to a stream, not to a market: a stream outlives the markets
// scheduled on it. Keyed by stream id so the API's streamId resolves directly.
//
// Caltrans was the whole pool and is gone from it. The manifests still parse, so
// every probe called them healthy, while segments arrived at 0.6 Mbit/s against
// a 2.1 Mbit/s stream — the player buffered forever and showed nothing. These
// are CDN-backed and carry six bitrates, so a thin connection drops to 144p
// instead of stalling.
//
// Video ids listed here rot: of four cameras qualified in one sitting, one had
// ended and one had vanished within hours, and channels that restart a stream
// daily mint a new id every morning. This map is a floor for streams the backend
// has no source for, not the source of truth — that is streams.source_url, which
// the inspector suspends and re-qualifies on its own.
const YOUTUBE = "https://www.youtube.com/watch?v=";

export const streamSourcePool: Record<string, Array<{ url: string; name: string; timeZone: string }>> = {
  "stream-london-abbey": [
    { url: `${YOUTUBE}M3EYAY2MftI`, name: "Abbey Road Crossing, London", timeZone: "Europe/London" },
  ],
  "stream-sd-8-taylor": [
    { url: `${YOUTUBE}2juLrCH5w9U`, name: "Ohio 741 at 73", timeZone: "America/New_York" },
  ],
};

export function sourcesFor(id: string) {
  return streamSourcePool[id] ?? streamSourcePool[streamKeyFor(id) ?? ""] ?? [];
}

/**
 * The stream a market observes. Relay paths are keyed by stream because one
 * camera outlives many markets on it, while ids arriving here are market ids
 * like `stream-sd-8-15-1785476115`. Asking the relay for a market id gets a
 * miss and quietly falls back to the third-party camera the relay exists to
 * avoid.
 */
export function streamKeyFor(id: string): string | null {
  if (streamSourcePool[id]) return id;
  const keys = Object.keys(streamSourcePool).filter((key) => id.startsWith(key));
  if (keys.length === 0) return null;
  // Longest match wins, so a stream id that prefixes another cannot capture it.
  return keys.reduce((longest, key) => (key.length > longest.length ? key : longest));
}
