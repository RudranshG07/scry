import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const nats = readFileSync(new URL("../infrastructure/nats.conf", import.meta.url), "utf8");

test("local infrastructure binds every published port to loopback", () => {
  const published = compose.match(/^\s+- .*:[0-9]+\s*$/gm) ?? [];
  assert.ok(published.length > 0, "compose should publish at least one port");
  for (const entry of published) {
    assert.match(entry, /- 127\.0\.0\.1:/, `${entry.trim()} is not bound to loopback`);
  }
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
