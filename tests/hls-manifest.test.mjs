import assert from "node:assert/strict";
import { test } from "node:test";

import { liveWindow, rewriteManifest } from "../src/lib/streams/manifest.ts";

const base = "https://cdn.example.com/live/720p/index.m3u8";
const link = (url) => `/api/hls/${Buffer.from(url).toString("base64url")}`;

function livePlaylist(count, mediaSequence = 0) {
  const segments = Array.from({ length: count }, (_, index) => `#EXTINF:5.0,\nseg${index}.ts`);
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:5",
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    ...segments,
  ].join("\n");
}

function segmentsOf(manifest) {
  return manifest.split("\n").filter((line) => line.startsWith("/api/hls/"));
}

test("relative segment urls are made absolute before they are linked", () => {
  const out = rewriteManifest(livePlaylist(1), base, link);
  const [segment] = segmentsOf(out);
  const decoded = Buffer.from(segment.replace("/api/hls/", ""), "base64url").toString();
  assert.equal(decoded, "https://cdn.example.com/live/720p/seg0.ts");
});

test("a live playlist is trimmed to the segments around the live edge", () => {
  const out = rewriteManifest(livePlaylist(2227), base, link);
  assert.equal(segmentsOf(out).length, liveWindow);
});

test("the last segment survives trimming, because that is the live edge", () => {
  const out = rewriteManifest(livePlaylist(2227), base, link);
  const last = segmentsOf(out).at(-1);
  const decoded = Buffer.from(last.replace("/api/hls/", ""), "base64url").toString();
  assert.match(decoded, /seg2226\.ts$/);
});

// Dropping the front of a playlist without moving the sequence number tells the
// player the stream restarted, and it reloads from the beginning forever.
test("media sequence moves by however many segments were dropped", () => {
  const out = rewriteManifest(livePlaylist(2227, 100), base, link);
  assert.match(out, new RegExp(`#EXT-X-MEDIA-SEQUENCE:${100 + 2227 - liveWindow}\\b`));
});

test("a playlist shorter than the window keeps its sequence number", () => {
  const out = rewriteManifest(livePlaylist(4, 42), base, link);
  assert.equal(segmentsOf(out).length, 4);
  assert.match(out, /#EXT-X-MEDIA-SEQUENCE:42\b/);
});

test("a finished recording is never trimmed", () => {
  const vod = `${livePlaylist(50)}\n#EXT-X-ENDLIST`;
  const out = rewriteManifest(vod, base, link);
  assert.equal(segmentsOf(out).length, 50);
  assert.match(out, /#EXT-X-ENDLIST/);
});

test("a master playlist keeps every variant", () => {
  const master = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=290288,RESOLUTION=256x144",
    "144p/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=5420722,RESOLUTION=1920x1080",
    "1080p/index.m3u8",
  ].join("\n");
  const out = rewriteManifest(master, base, link);
  assert.equal(segmentsOf(out).length, 2);
});

test("uri attributes on tags are linked too", () => {
  const withKey = [
    "#EXTM3U",
    "#EXT-X-MEDIA-SEQUENCE:0",
    '#EXT-X-KEY:METHOD=AES-128,URI="secret.key"',
    "#EXTINF:5.0,",
    "seg0.ts",
  ].join("\n");
  const out = rewriteManifest(withKey, base, link);
  const key = out.match(/URI="([^"]+)"/)[1];
  const decoded = Buffer.from(key.replace("/api/hls/", ""), "base64url").toString();
  assert.equal(decoded, "https://cdn.example.com/live/720p/secret.key");
});
