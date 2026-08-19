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
