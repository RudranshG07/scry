// A live window only needs the segments around the live edge. YouTube serves a
// four hour DVR playlist, and signing each of its 2227 entries produced a 3.5MB
// manifest that hls.js refetches every couple of seconds — enough on its own to
// starve the video it was meant to deliver.
export const liveWindow = 20;

function absolute(reference: string, base: string) {
  try {
    return new URL(reference, base).toString();
  } catch {
    return null;
  }
}

function rewriteLine(line: string, base: string, link: (url: string) => string) {
  const trimmed = line.trim();
  if (!trimmed) return line;

  if (trimmed.startsWith("#")) {
    return line.replace(/URI="([^"]+)"/g, (match, reference: string) => {
      const resolved = absolute(reference, base);
      return resolved ? `URI="${link(resolved)}"` : match;
    });
  }

  const resolved = absolute(trimmed, base);
  return resolved ? link(resolved) : line;
}

/**
 * Points every URL in a playlist back through `link`, and trims a live playlist
 * to its last segments.
 *
 * Trimming applies to live playlists only. A playlist carrying EXT-X-ENDLIST is
 * a finished recording, and dropping the front of one loses footage rather than
 * backlog. Media sequence has to move by however many segments went, or the
 * player treats what is left as the start of the stream and reloads it forever.
 */
export function rewriteManifest(body: string, base: string, link: (url: string) => string) {
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.startsWith("#EXTINF"));
  const live = !lines.some((line) => line.startsWith("#EXT-X-ENDLIST"));
  if (first < 0 || !live) {
    return lines.map((line) => rewriteLine(line, base, link)).join("\n");
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
      : rewriteLine(line, base, link),
  );

  return [...header, ...kept.flat().map((line) => rewriteLine(line, base, link))].join("\n");
}
