const allowedHosts = new Set(
  (process.env.SCRY_STREAM_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

const playlistTypes = ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl"];

function isAllowed(target: URL) {
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  const host = target.hostname.toLowerCase();
  return allowedHosts.has(host) || [...allowedHosts].some((allowed) => host.endsWith(`.${allowed}`));
}

function proxied(absolute: string) {
  return `/api/stream?url=${encodeURIComponent(absolute)}`;
}

function rewritePlaylist(body: string, base: URL) {
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${proxied(new URL(uri, base).toString())}"`);
      }

      return proxied(new URL(trimmed, base).toString());
    })
    .join("\n");
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return Response.json({ error: "A url parameter is required." }, { status: 400 });
  }

  if (allowedHosts.size === 0) {
    return Response.json(
      { error: "Stream proxying is not configured. Set SCRY_STREAM_ALLOWED_HOSTS." },
      { status: 503 },
    );
  }

  let upstream: URL;
  try {
    upstream = new URL(target);
  } catch {
    return Response.json({ error: "The url parameter is not a valid URL." }, { status: 400 });
  }

  if (!isAllowed(upstream)) {
    return Response.json({ error: "That host is not on the stream allowlist." }, { status: 403 });
  }

  let response: Response;
  try {
    response = await fetch(upstream, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "*/*",
        "User-Agent": "Mozilla/5.0 (compatible; ScryStreamProxy/1.0)",
        Referer: upstream.origin,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "The upstream stream did not respond." }, { status: 502 });
  }

  if (!response.ok) {
    return Response.json({ error: `The upstream stream returned ${response.status}.` }, { status: 502 });
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const isPlaylist =
    playlistTypes.some((type) => contentType.includes(type)) || upstream.pathname.toLowerCase().endsWith(".m3u8");

  if (isPlaylist) {
    const body = await response.text();
    return new Response(rewritePlaylist(body, upstream), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=10",
    },
  });
}
