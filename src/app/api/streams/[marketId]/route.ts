import { clipFor, sourcesFor } from "@/lib/markets";

export type ResolvedStream = {
  url: string;
  poster?: string;
  name: string;
  kind: "hls" | "video";
  live: boolean;
  daylight?: boolean;
};

const probeTimeoutMs = 4000;
const cacheTtlMs = 20_000;
const daylightStartHour = 7;
const daylightEndHour = 19;

const cache = new Map<string, { at: number; value: ResolvedStream }>();

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

function playlistEntries(body: string) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function isPlayable(playlistUrl: string) {
  try {
    const body = await fetchText(playlistUrl);
    if (!body?.startsWith("#EXTM3U")) return false;

    const entries = playlistEntries(body);
    if (entries.length === 0) return false;
    if (!/\.m3u8(?:$|[?#])/i.test(entries[0])) return true;

    const chunklist = await fetchText(new URL(entries[0], new URL(playlistUrl)).toString());
    if (!chunklist?.startsWith("#EXTM3U")) return false;
    return playlistEntries(chunklist).some((entry) => /\.(ts|m4s|mp4)(?:$|[?#])/i.test(entry));
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

  const sources = sourcesFor(marketId);

  // An origin we control always wins: mediamtx reconnects behind a stable path.
  const origin = process.env.SCRY_MEDIA_ORIGIN?.trim().replace(/\/+$/, "");
  if (origin && sources.length > 0) {
    const republished = `${origin}/${encodeURIComponent(marketId)}/index.m3u8`;
    if (await isPlayable(republished)) {
      return finish({ url: republished, name: sources[0].name, kind: "hls", live: true, daylight: true });
    }
  }

  // Cameras in daylight first — a live feed nobody can see through earns no trust.
  // Within each group the pool is ordered by how well the scene frames a count line.
  const daylit = sources.filter((source) => isDaylight(source.timeZone));
  const dark = sources.filter((source) => !isDaylight(source.timeZone));

  for (const source of [...daylit, ...dark]) {
    if (await isPlayable(source.url)) {
      return finish({
        url: source.url,
        name: source.name,
        kind: "hls",
        live: true,
        daylight: isDaylight(source.timeZone),
      });
    }
  }

  const clip = clipFor(marketId);
  if (clip) {
    return finish({ url: clip.url, poster: clip.poster, name: clip.name, kind: "video", live: false });
  }

  return finish({ url: "/landing/hero.mp4", name: "Reference footage", kind: "video", live: false });
}
