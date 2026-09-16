import assert from "node:assert/strict";
import test from "node:test";

import { countLine, coverBox } from "../src/lib/video.ts";

test("a wide frame in a square box is cropped left and right", () => {
  const box = coverBox({ width: 1920, height: 1080 }, { width: 600, height: 600 });
  assert.equal(box.height, 600);
  assert.ok(box.width > 600);
  assert.ok(box.left < 0 && Math.abs(box.left * 2 + box.width - 600) < 0.001);
  assert.equal(box.top, 0);
});

test("a tall frame in a wide box is cropped top and bottom", () => {
  const box = coverBox({ width: 720, height: 1280 }, { width: 800, height: 450 });
  assert.equal(box.width, 800);
  assert.ok(box.height > 450);
  assert.ok(box.top < 0);
});

test("a frame the same shape as its box fills it exactly", () => {
  assert.deepEqual(coverBox({ width: 1280, height: 720 }, { width: 640, height: 360 }), {
    left: 0,
    top: 0,
    width: 640,
    height: 360,
  });
});

test("a video that has not loaded yet leaves the overlay on the box", () => {
  assert.deepEqual(coverBox({ width: 0, height: 0 }, { width: 640, height: 360 }), {
    left: 0,
    top: 0,
    width: 640,
    height: 360,
  });
});

test("the drawn line is the one the observers count across", () => {
  const claim = { kind: "crossings", target: "anything", options: { line: [[0.05, 0.42], [0.95, 0.42]] } };
  assert.deepEqual(countLine(claim), { from: [0.05, 0.42], to: [0.95, 0.42] });
});

test("nothing is drawn for a market with no line to cross", () => {
  assert.equal(countLine({ kind: "phrase", options: {} }), null);
  assert.equal(countLine({ kind: "crossings" }), null);
  assert.equal(countLine(), null);
  // Coordinates are fractions of the frame; anything else would be drawn in the
  // wrong place rather than not at all.
  assert.equal(countLine({ kind: "crossings", options: { line: [[0.1, 0.5], [2, 0.5]] } }), null);
  assert.equal(countLine({ kind: "crossings", options: { line: [[0.1, 0.5]] } }), null);
});
