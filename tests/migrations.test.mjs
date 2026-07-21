import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const directory = new URL("../database/migrations/", import.meta.url);

test("database migrations are ordered transactions without inline comments", () => {
  const names = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(names, ["001_core.sql", "002_timeseries.sql", "003_operations.sql", "004_reputation.sql"]);
  for (const name of names) {
    const sql = readFileSync(new URL(name, directory), "utf8");
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /COMMIT;\s*$/);
    assert.doesNotMatch(sql, /--|\/\*/);
  }
});

test("database migrations cover durable events, time series, evidence, and alerts", () => {
  const sql = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, directory), "utf8"))
    .join("\n");
  for (const table of [
    "chain_events",
    "event_outbox",
    "count_observations",
    "stream_health_samples",
    "market_probability_history",
    "evidence_records",
    "indexer_checkpoints",
    "operational_alerts",
    "forecaster_reputation_snapshots",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(sql, /create_hypertable\('count_observations'/);
  assert.match(sql, /UNIQUE \(chain_id, transaction_hash, log_index\)/);
});
