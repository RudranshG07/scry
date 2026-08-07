import { spawn } from "node:child_process";

export type Upstream = { manifest: string; expiresAt: number };

const resolverTimeoutMs = 20_000;
const cacheTtlMs = 30 * 60 * 1000;
const failureTtlMs = 60 * 1000;

const cache = new Map<string, { upstream: Upstream | null; at: number }>();
const inFlight = new Map<string, Promise<Upstream | null>>();

export function isManifest(url: string) {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

function run(command: string, args: string[]) {
  return new Promise<string | null>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), resolverTimeoutMs);
    let out = "";

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
  });
}

/**
 * The variant playlist, not a single rendition. `-g` hands back whichever
 * rendition yt-dlp ranks best, which here was 1080p at 5.4 Mbit/s and arrived
 * at 0.6x realtime — the player stalls with a full manifest and nothing to
 * show. The master lists every bitrate down to 144p and lets hls.js pick one
 * the connection can hold.
 */
async function viaYtDlp(source: string): Promise<string | null> {
  const probed = await run("yt-dlp", ["-J", "--no-warnings", "--no-playlist", source]);
  if (probed) {
    try {
      const payload = JSON.parse(probed) as { manifest_url?: string; formats?: Array<{ manifest_url?: string }> };
      const master = payload.manifest_url ?? payload.formats?.find((format) => format.manifest_url)?.manifest_url;
      if (master) return master;
    } catch {
      // fall through to -g
    }
  }

  const direct = await run("yt-dlp", ["-g", "-f", "best[protocol^=m3u8]/best", "--no-warnings", source]);
  return direct?.split("\n").find((line) => line.startsWith("http")) ?? null;
}

export async function resolveUpstream(source: string): Promise<Upstream | null> {
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (isManifest(trimmed)) return { manifest: trimmed, expiresAt: Date.now() + cacheTtlMs };

  const cached = cache.get(trimmed);
  if (cached && Date.now() - cached.at < (cached.upstream ? cacheTtlMs : failureTtlMs)) {
    return cached.upstream;
  }

  const running = inFlight.get(trimmed);
  if (running) return running;

  const attempt = viaYtDlp(trimmed)
    .then((manifest) => {
      const upstream = manifest ? { manifest, expiresAt: Date.now() + cacheTtlMs } : null;
      cache.set(trimmed, { upstream, at: Date.now() });
      return upstream;
    })
    .finally(() => inFlight.delete(trimmed));

  inFlight.set(trimmed, attempt);
  return attempt;
}
