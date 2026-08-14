import { sourcesFor, streamKeyFor } from "@/lib/markets";
import { proxyPath } from "@/lib/streams/signing";
import { resolveUpstream } from "@/lib/streams/upstream";

export type ResolvedStream = {
  url: string;
  poster?: string;
  name: string;
  kind: "hls" | "video";
  live: boolean;
  daylight?: boolean;
};

export const dynamic = "force-dynamic";

const probeTimeoutMs = 12_000;
const cacheTtlMs = 120_000;
const daylightStartHour = 7;
const daylightEndHour = 19;

// A segment has to arrive faster than it plays or the buffer drains. Caltrans
// managed 0.6 of realtime and the manifest looked perfectly healthy the whole
// time, so playability is measured in bytes per second, not in whether the
// playlist parses.
const minimumRealtime = 1.1;

const cache = new Map<string, { at: number; value: ResolvedStream }>();

type ApiStream = { id: string; name: string; timezone: string; sourceUrl: string };

/**
 * What the backend says this market's camera is.
 *
 * The pool in markets.ts is a floor for streams that predate the front door,
 * not the source of truth. Anything submitted through the API — which is how
 * cameras arrive now, and how they are replaced when one dies — is unknown to
 * it, so a market on one resolved to nothing and the player showed its error
 * state over a stream that was working.
 */
async function sourceFromApi(marketId: string) {
  const api = process.env.NEXT_PUBLIC_SCRY_API_URL?.trim().replace(/\/+$/, "");
  if (!api) return null;

  try {
    const response = await fetch(`${api}/v1/streams`, {
      cache: "no-store",
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    if (!response.ok) return null;

    const streams = (await response.json()) as ApiStream[];
    // Market ids are the stream id plus a timestamp, so the longest matching
    // stream wins: one id that prefixes another must not capture it.
    const matches = streams.filter((stream) => marketId.startsWith(stream.id) && stream.sourceUrl);
    if (matches.length === 0) return null;
    return matches.reduce((longest, stream) => (stream.id.length > longest.id.length ? stream : longest));
  } catch {
    return null;
  }
}

function localHour(timeZone: string) {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(new Date());
  return Number.parseInt(hour, 10);
}

function isDaylight(timeZone: string) {
  try {
    const hour = localHour(timeZone);
    return hour >= daylightStartHour && hour < daylightEndHour;
  } catch {
    return true;
  }
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(probeTimeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ScryStreamProbe/1.0)" },
  });
  if (!response.ok) return null;
  return response.text();
}

function entries(body: string) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function segmentSeconds(body: string) {
  const match = body.match(/#EXTINF:\s*([0-9.]+)/);
  return match ? Number.parseFloat(match[1]) : 0;
}

async function measure(segmentUrl: string, covers: number) {
  const started = Date.now();
  const response = await fetch(segmentUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(probeTimeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ScryStreamProbe/1.0)" },
  });
  if (!response.ok) return 0;
  await response.arrayBuffer();
  const elapsed = (Date.now() - started) / 1000;
  return elapsed > 0 ? covers / elapsed : 0;
}

/**
 * Walks a manifest to a real segment and times it. A master playlist is probed
 * at its lowest bitrate: that is the one hls.js falls back to when the
 * connection is thin, so if it cannot keep up, none of the others will either.
 */
async function isPlayable(manifestUrl: string) {
  try {
    const body = await fetchText(manifestUrl);
    if (!body?.startsWith("#EXTM3U")) return false;

    const listed = entries(body);
    if (listed.length === 0) return false;

    let media = body;
    let mediaUrl = manifestUrl;
    if (/\.m3u8(?:$|[?#])/i.test(listed[0])) {
      mediaUrl = new URL(listed[listed.length - 1], manifestUrl).toString();
      const variant = await fetchText(mediaUrl);
      if (!variant?.startsWith("#EXTM3U")) return false;
      media = variant;
    }

    const segments = entries(media).filter((entry) => /\.(ts|m4s|mp4)(?:$|[?#])/i.test(entry));
    if (segments.length === 0) return false;

    const covers = segmentSeconds(media);
    if (covers <= 0) return false;

    const rate = await measure(new URL(segments[0], mediaUrl).toString(), covers);
    return rate >= minimumRealtime;
  } catch {
    return false;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await context.params;

  const cached = cache.get(marketId);
  if (cached && Date.now() - cached.at < cacheTtlMs) {
    return Response.json(cached.value, { headers: { "Cache-Control": "no-store" } });
  }

  const finish = (value: ResolvedStream) => {
    cache.set(marketId, { at: Date.now(), value });
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  };

  const known = await sourceFromApi(marketId);
  const sources = known
    ? [{ url: known.sourceUrl, name: known.name || known.id, timeZone: known.timezone || "UTC" },
       ...sourcesFor(marketId)]
    : sourcesFor(marketId);

  // An origin we control always wins: mediamtx reconnects behind a stable path.
  const origin = process.env.SCRY_MEDIA_ORIGIN?.trim().replace(/\/+$/, "");
  if (origin && sources.length > 0) {
    const republished = `${origin}/${encodeURIComponent(streamKeyFor(marketId) ?? marketId)}/index.m3u8`;
    if (await isPlayable(republished)) {
      return finish({ url: republished, name: sources[0].name, kind: "hls", live: true, daylight: true });
    }
  }

  // Cameras in daylight first — a live feed nobody can see through earns no trust.
  // Within each group the pool is ordered by how well the scene frames a count line.
  const daylit = sources.filter((source) => isDaylight(source.timeZone));
  const dark = sources.filter((source) => !isDaylight(source.timeZone));

  for (const source of [...daylit, ...dark]) {
    const upstream = await resolveUpstream(source.url);
    if (!upstream) continue;
    if (!(await isPlayable(upstream.manifest))) continue;

    // Proxied, not handed over directly. These hosts answer a plain GET but
    // send no access-control-allow-origin, and hls.js reads every manifest and
    // segment with fetch, so the browser refuses all of them cross-origin.
    return finish({
      url: proxyPath(upstream.manifest),
      name: source.name,
      kind: "hls",
      live: true,
      daylight: isDaylight(source.timeZone),
    });
  }

  // No stand-in footage. A market whose camera cannot be reached used to fall
  // back to a recorded clip labelled "Reference footage", which plays exactly
  // like the live feed and sits under a count the clip has nothing to do with.
  // The player has an honest empty state; this is what it is for.
  return finish({ url: "", name: "", kind: "hls", live: false });
}
