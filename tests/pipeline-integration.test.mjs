import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeFinalizedEvent } from "../services/indexer/event-codec.ts";
import { MarketProjector } from "../services/indexer/projector.ts";

function metadata(sequence) {
  return {
    eventId: `integration-${sequence}`,
    chainId: 8453,
    blockNumber: String(1000 + sequence),
    transactionIndex: 0,
    logIndex: 0,
    transactionHash: `0x${String(sequence).padStart(64, "0")}`,
    blockHash: `0x${String(sequence + 100).padStart(64, "0")}`,
    recordedAt: `2026-07-20T14:01:0${sequence}.000Z`,
    marketId: "indore-gate-a",
  };
}

test("observation commitment projects through the finalized event boundary", () => {
  const curation = JSON.parse(execFileSync(
    "python3",
    ["-m", "scry_curation.cli", "services/curation/fixtures/approved_market.json"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: "services/curation" },
      encoding: "utf8",
    },
  ));
  const observationInput = JSON.parse(readFileSync("services/observation/fixtures/valid_observation.json", "utf8"));
  observationInput.ruleHash = curation.rule_hash;
  const raw = execFileSync(
    "python3",
    ["-c", "import json,sys; from scry_observation.pipeline import execute_observation; print(json.dumps(execute_observation(json.load(sys.stdin))))"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: "services/observation" },
      encoding: "utf8",
      input: JSON.stringify(observationInput),
    },
  );
  const observation = JSON.parse(raw);
  assert.equal(curation.approved, true);
  assert.equal(observation.commitment.payload.ruleHash, curation.rule_hash);
  const projector = new MarketProjector();
  projector.apply(decodeFinalizedEvent({
    ...metadata(1),
    type: "market.created",
    contractAddress: `0x${"2".repeat(40)}`,
    streamId: observation.commitment.payload.streamId,
    ruleHash: observation.commitment.payload.ruleHash,
    outcomes: ["yes", "no"],
    initialStatus: "Open",
  }));
  projector.apply(decodeFinalizedEvent({ ...metadata(2), type: "market.locked" }));
  projector.apply(decodeFinalizedEvent({
    ...metadata(3),
    type: "observation.proposed",
    observedValue: String(observation.commitment.payload.observedValue),
    winningOutcomeId: observation.commitment.payload.winningOutcomeId,
    evidenceRoot: observation.commitment.evidenceRoot,
  }));
  projector.apply(decodeFinalizedEvent({ ...metadata(4), type: "market.resolved" }));

  const market = projector.markets.get("indore-gate-a");
  assert.equal(market.status, "Resolved");
  assert.equal(market.observedValue, 182n);
  assert.equal(market.winningOutcomeId, "yes");
  assert.equal(market.evidenceRoot, observation.commitment.evidenceRoot);
});

test("the observation window is the same length in Go and in Python", () => {
  // The threshold a market turns on is measured over a short sample and scaled
  // up to a whole window. The scheduler decides how long that window is; the
  // qualifier decides what number it takes to win. If the two disagree, every
  // market settles the same way whatever crossed the line — a bar set for
  // fifteen minutes cannot be met in four — and nothing in either service is
  // wrong on its own, so nothing reports it.
  const schedule = readFileSync("services/api-go/internal/engine/schedule.go", "utf8");
  const qualify = readFileSync("services/vision/scry_vision/qualify.py", "utf8");

  const go = schedule.match(/observeWindow\s*=\s*(\d+)\s*\*\s*time\.Minute/);
  const python = qualify.match(/OBSERVATION_WINDOW\s*=\s*(\d+)\s*\*\s*60/);

  assert.ok(go, "schedule.go no longer declares observeWindow in minutes");
  assert.ok(python, "qualify.py no longer declares OBSERVATION_WINDOW in minutes");
  assert.equal(Number(python[1]), Number(go[1]));
});

test("the relay publishes at the cadence the observers count at", () => {
  // The relay drops the stream to the sampling rate so the observers do not
  // decode thirty frames a second to look at eight. That makes its frame rate
  // the counting cadence: serve less than SAMPLE_FPS and no observer can reach
  // the rate its thresholds were calibrated at, and every market on that camera
  // settles low without one line of either service being wrong.
  const ingest = readFileSync("infrastructure/relay/ingest.sh", "utf8");
  const crossings = readFileSync("services/vision/scry_vision/crossings.py", "utf8");

  const relay = ingest.match(/SCRY_RELAY_FPS:-(\d+(?:\.\d+)?)\}/);
  const sample = crossings.match(/SAMPLE_FPS\s*=\s*(\d+(?:\.\d+)?)/);

  assert.ok(relay, "ingest.sh no longer defaults SCRY_RELAY_FPS");
  assert.ok(sample, "crossings.py no longer declares SAMPLE_FPS");
  assert.equal(Number(relay[1]), Number(sample[1]));
});

test("the cadence tolerance leaves a thirty frame source sampled as before", () => {
  // The tolerance exists so a source arriving at exactly the sampling rate is
  // not thrown away by the check meant to enforce it. It must not also change
  // what a thirty frame source does: at that rate a frame lands every 33ms, and
  // slack of 25ms or more starts taking every third one instead of every
  // fourth, which is a 25% cadence change and silently invalidates every
  // threshold stored against it.
  const crossings = readFileSync("services/vision/scry_vision/crossings.py", "utf8");
  const slack = crossings.match(/CADENCE_SLACK\s*=\s*([\d.]+)/);
  const sample = crossings.match(/SAMPLE_FPS\s*=\s*(\d+(?:\.\d+)?)/);

  assert.ok(slack, "crossings.py no longer declares CADENCE_SLACK");
  const interval = 1 / Number(sample[1]);
  const threshold = interval - Number(slack[1]);

  const kept = (fps) => {
    for (let n = 1; n < 100; n += 1) if (n / fps >= threshold) return n;
    throw new Error("never samples");
  };
  assert.equal(kept(30), 4);
  assert.ok(threshold < interval, "the tolerance must leave room for jitter");
});

test("the scene drift budget is the same in Go and in Python", () => {
  // The qualifier records what the camera was looking at and the API refuses a
  // count taken on a scene too far from it. Two numbers, two languages, one
  // decision: raise one and markets void on cameras that never moved, raise the
  // other and a camera that panned off the count line keeps settling markets.
  const scene = readFileSync("services/api-go/internal/httpapi/scene.go", "utf8");
  const python = readFileSync("services/vision/scry_vision/scene.py", "utf8");

  const go = scene.match(/maxSceneDrift\s*=\s*(\d+)/);
  const py = python.match(/MAX_DRIFT\s*=\s*(\d+)/);

  assert.ok(go, "scene.go no longer declares maxSceneDrift");
  assert.ok(py, "scene.py no longer declares MAX_DRIFT");
  assert.equal(Number(py[1]), Number(go[1]));
});
