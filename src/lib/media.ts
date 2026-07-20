export type StreamPlayback =
  | { kind: "fallback" }
  | { kind: "hls" | "video"; url: string };

function playbackKind(url: string) {
  return /\.m3u8(?:$|[?#])/i.test(url) ? "hls" : "video";
}

export function resolveStreamPlayback(
  streamId: string,
  template = process.env.NEXT_PUBLIC_SCRY_STREAM_URL_TEMPLATE?.trim(),
  hlsBaseUrl = process.env.NEXT_PUBLIC_SCRY_HLS_BASE_URL?.trim(),
): StreamPlayback {
  const encodedId = encodeURIComponent(streamId);

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
