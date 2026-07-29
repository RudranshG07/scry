export type StreamPlayback =
  | { kind: "fallback" }
  | { kind: "livekit"; url: string; tokenEndpoint: string }
  | { kind: "hls" | "video"; url: string };

function playbackKind(url: string) {
  return /\.m3u8(?:$|[?#])/i.test(url) ? "hls" : "video";
}

export function proxiedStreamUrl(url: string) {
  return `/api/stream?url=${encodeURIComponent(url)}`;
}

export function needsStreamProxy(
  url: string,
  hosts = process.env.NEXT_PUBLIC_SCRY_STREAM_PROXY_HOSTS?.trim(),
) {
  if (!hosts) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function resolveMarketPlayback(
  streamId: string,
  sourceUrl?: string,
  proxyHosts?: string,
): StreamPlayback {
  const source = sourceUrl?.trim();
  if (!source) return resolveStreamPlayback(streamId);

  const absolute = /^https?:\/\//i.test(source);
  const url = absolute && needsStreamProxy(source, proxyHosts) ? proxiedStreamUrl(source) : source;
  return { kind: playbackKind(source), url };
}

export function resolveStreamPlayback(
  streamId: string,
  template = process.env.NEXT_PUBLIC_SCRY_STREAM_URL_TEMPLATE?.trim(),
  hlsBaseUrl = process.env.NEXT_PUBLIC_SCRY_HLS_BASE_URL?.trim(),
  livekitUrl = process.env.NEXT_PUBLIC_SCRY_LIVEKIT_URL?.trim(),
  apiUrl = process.env.NEXT_PUBLIC_SCRY_API_URL?.trim(),
): StreamPlayback {
  const encodedId = encodeURIComponent(streamId);

  if (livekitUrl && apiUrl) {
    return {
      kind: "livekit",
      url: livekitUrl,
      tokenEndpoint: `${apiUrl.replace(/\/+$/, "")}/v1/streams/${encodedId}/playback-token`,
    };
  }

  if (template) {
    const url = template.includes("{streamId}")
      ? template.replaceAll("{streamId}", encodedId)
      : template;
    return { kind: playbackKind(url), url };
  }

  if (hlsBaseUrl) {
    const baseUrl = hlsBaseUrl.replace(/\/+$/, "");
    return { kind: "hls", url: `${baseUrl}/${encodedId}/index.m3u8` };
  }

  return { kind: "fallback" };
}
