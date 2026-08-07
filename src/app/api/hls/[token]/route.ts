import { proxyPath, verifyUrl } from "@/lib/streams/signing";

export const dynamic = "force-dynamic";

const upstreamTimeoutMs = 20_000;
const manifestTypes = /mpegurl|m3u8/i;
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function absolute(reference: string, base: string) {
  try {
    return new URL(reference, base).toString();
  } catch {
    return null;
  }
}

// A live window only needs the segments around the live edge. YouTube serves a
// four hour DVR playlist, and signing each of its 2227 entries produced a 3.5MB
// manifest that hls.js refetches every couple of seconds — enough on its own to
// starve the video it was meant to deliver.
const liveWindow = 20;

function rewriteLine(line: string, base: string) {
  const trimmed = line.trim();
  if (!trimmed) return line;

  if (trimmed.startsWith("#")) {
    return line.replace(/URI="([^"]+)"/g, (match, reference: string) => {
      const resolved = absolute(reference, base);
      return resolved ? `URI="${proxyPath(resolved)}"` : match;
    });
  }

  const resolved = absolute(trimmed, base);
  return resolved ? proxyPath(resolved) : line;
}

/**
 * Every URL a manifest points at has to come back through this origin. The
 * hosts behind these streams answer a plain GET but send no
 * access-control-allow-origin, so hls.js — which reads manifests and segments
 * with fetch — is refused by the browser on all of them. Same-origin is not an
 * optimisation here, it is the only way the bytes reach the player.
 */
function rewrite(body: string, base: string) {
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.startsWith("#EXTINF"));
  const live = !lines.some((line) => line.startsWith("#EXT-X-ENDLIST"));
  if (first < 0 || !live) {
    return lines.map((line) => rewriteLine(line, base)).join("\n");
  }

  const blocks: string[][] = [];
  let pending: string[] = [];
  for (const line of lines.slice(first)) {
    pending.push(line);
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      blocks.push(pending);
      pending = [];
    }
  }

  const kept = blocks.slice(-liveWindow);
  const dropped = blocks.length - kept.length;
  const header = lines.slice(0, first).map((line) =>
    line.startsWith("#EXT-X-MEDIA-SEQUENCE")
      ? `#EXT-X-MEDIA-SEQUENCE:${Number.parseInt(line.split(":")[1] ?? "0", 10) + dropped}`
      : rewriteLine(line, base),
  );

  return [...header, ...kept.flat().map((line) => rewriteLine(line, base))].join("\n");
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const target = verifyUrl(token);
  if (!target) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(upstreamTimeoutMs),
      headers: {
        "User-Agent": userAgent,
        Accept: "*/*",
        ...(range ? { Range: range } : {}),
      },
    });
  } catch {
    return new Response("Upstream unreachable", { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Upstream refused", { status: upstream.status === 403 ? 403 : 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const looksLikeManifest = manifestTypes.test(contentType) || /\.m3u8(?:$|[?#])/i.test(target);

  if (looksLikeManifest) {
    const body = await upstream.text();
    if (!body.trimStart().startsWith("#EXTM3U")) {
      return new Response("Not a playlist", { status: 502 });
    }
    return new Response(rewrite(body, upstream.url || target), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const headers = new Headers({
    "Content-Type": contentType || "video/mp2t",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
