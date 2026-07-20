import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const nats = readFileSync(new URL("../infrastructure/nats.conf", import.meta.url), "utf8");

test("local infrastructure binds data services only to loopback", () => {
  const publishedPorts = compose.match(/127\.0\.0\.1:[^\n]+/g) ?? [];
  assert.equal(publishedPorts.length, 4);
  assert.doesNotMatch(compose, /\n\s+- [0-9]+:[0-9]+/);
});

test("local infrastructure requires a database secret and applies migrations", () => {
  assert.match(compose, /SCRY_POSTGRES_PASSWORD:\?SCRY_POSTGRES_PASSWORD is required/);
  assert.match(compose, /\.\/database\/migrations:\/docker-entrypoint-initdb\.d:ro/);
});

test("NATS enables durable JetStream storage and monitoring", () => {
  assert.match(nats, /jetstream \{/);
  assert.match(nats, /store_dir: \/data\/jetstream/);
  assert.match(nats, /http_port: 8222/);
});
