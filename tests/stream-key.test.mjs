import assert from "node:assert/strict";
import test from "node:test";

import { sourcesFor, streamKeyFor } from "../src/lib/markets.ts";

test("a live market id resolves to the stream it observes", () => {
  // Engine market ids are the stream id plus a timestamp. Asking the relay for
  // the whole thing misses, and the miss silently falls back to the very
  // third-party camera the relay exists to stop depending on.
  assert.equal(streamKeyFor("stream-sd-8-15-1785476115"), "stream-sd-8-15");
  assert.equal(streamKeyFor("stream-sd-5-28th-1785474615"), "stream-sd-5-28th");
});

test("a stream id resolves to itself", () => {
  assert.equal(streamKeyFor("stream-sd-8-15"), "stream-sd-8-15");
});

test("an unknown id resolves to nothing rather than a wrong camera", () => {
  assert.equal(streamKeyFor("some-other-market"), null);
});

test("a market keeps the sources of its own stream", () => {
  const direct = sourcesFor("stream-sd-8-15");
  const viaMarket = sourcesFor("stream-sd-8-15-1785476115");
  assert.ok(direct.length > 0);
  assert.deepEqual(viaMarket, direct);
});
