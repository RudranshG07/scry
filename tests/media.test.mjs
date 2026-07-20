import assert from "node:assert/strict";
import test from "node:test";
import { resolveStreamPlayback } from "../src/lib/media.ts";

test("media playback falls back when no source is configured", () => {
  assert.deepEqual(resolveStreamPlayback("stream-a", "", ""), { kind: "fallback" });
});

test("media templates encode stream identifiers", () => {
  assert.deepEqual(
    resolveStreamPlayback("gate a/1", "https://media.scry.test/{streamId}/live.m3u8", ""),
    { kind: "hls", url: "https://media.scry.test/gate%20a%2F1/live.m3u8" },
  );
});

test("media templates support direct video sources", () => {
  assert.deepEqual(
    resolveStreamPlayback("stream-a", "https://media.scry.test/live.mp4", ""),
    { kind: "video", url: "https://media.scry.test/live.mp4" },
  );
});

test("media base URLs resolve the conventional HLS path", () => {
  assert.deepEqual(
    resolveStreamPlayback("stream-a", "", "https://media.scry.test/hls/"),
    { kind: "hls", url: "https://media.scry.test/hls/stream-a/index.m3u8" },
  );
});

test("LiveKit playback is preferred when its server and token API are configured", () => {
  assert.deepEqual(
    resolveStreamPlayback(
      "stream-a",
      "https://media.scry.test/live.mp4",
      "https://media.scry.test/hls",
      "wss://live.scry.test",
      "https://api.scry.test/",
    ),
    {
      kind: "livekit",
      url: "wss://live.scry.test",
      tokenEndpoint: "https://api.scry.test/v1/streams/stream-a/playback-token",
    },
  );
});
