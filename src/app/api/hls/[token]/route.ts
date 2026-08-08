import { rewriteManifest } from "@/lib/streams/manifest";
import { proxyPath, verifyUrl } from "@/lib/streams/signing";

export const dynamic = "force-dynamic";

const upstreamTimeoutMs = 20_000;
const manifestTypes = /mpegurl|m3u8/i;
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

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
    // Every URL a manifest points at has to come back through this origin. The
    // hosts behind these streams answer a plain GET but send no
    // access-control-allow-origin, and hls.js reads manifests and segments with
    // fetch, so the browser refuses all of them cross-origin.
    return new Response(rewriteManifest(body, upstream.url || target, proxyPath), {
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
