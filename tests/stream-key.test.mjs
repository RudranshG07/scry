import assert from "node:assert/strict";
import test from "node:test";

import { sourcesFor, streamKeyFor, streamSourcePool } from "../src/lib/markets.ts";

// Taken from the pool rather than named outright. Cameras go dark and get
// replaced — two of four did so within hours of being qualified — and a test
// that hardcodes one is testing the pool's contents instead of the id
// arithmetic it means to cover.
const [stream] = Object.keys(streamSourcePool);

test("a live market id resolves to the stream it observes", () => {
  // Engine market ids are the stream id plus a timestamp. Asking the relay for
  // the whole thing misses, and the miss silently falls back to the very
  // third-party camera the relay exists to stop depending on.
  assert.equal(streamKeyFor(`${stream}-1785476115`), stream);
});

test("a stream id resolves to itself", () => {
  assert.equal(streamKeyFor(stream), stream);
});

test("an unknown id resolves to nothing rather than a wrong camera", () => {
  assert.equal(streamKeyFor("some-other-market"), null);
});

test("the longest matching stream wins, so one id cannot capture another", () => {
  const pool = { ...streamSourcePool };
  const keys = Object.keys(pool).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    assert.equal(streamKeyFor(`${key}-1785476115`), key);
  }
});

test("a market keeps the sources of its own stream", () => {
  const direct = sourcesFor(stream);
  const viaMarket = sourcesFor(`${stream}-1785476115`);
  assert.ok(direct.length > 0);
  assert.deepEqual(viaMarket, direct);
});

test("every pooled source is a link the resolver knows how to open", () => {
  for (const [id, sources] of Object.entries(streamSourcePool)) {
    assert.ok(sources.length > 0, `${id} has no sources`);
    for (const source of sources) {
      assert.match(source.url, /^https:\/\//, `${id} source is not a url`);
      assert.ok(source.name.length > 0, `${id} source has no name`);
      // Used to decide whether a camera is in daylight, so a typo here silently
      // sorts a dark camera to the front of the pool.
      assert.doesNotThrow(
        () => new Intl.DateTimeFormat("en-GB", { timeZone: source.timeZone }),
        `${id} has an unusable time zone`,
      );
    }
  }
});
