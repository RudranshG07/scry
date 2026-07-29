# Scry

Live prediction markets for measurable physical-world events.

Users watch authorized, anonymized streams (traffic gates, parking lots, queues, venue entrances), predict a measurable outcome before the market locks, watch it resolve live, then inspect how the result was observed. The full product and market strategy lives in `Scry_Product_and_Technical_Strategy_FINAL.docx`.

The architecture is hybrid: video, computer vision, chat and forecasting stay off-chain; market creation, positions, evidence roots and claims are intended to settle on Base. Markets are parimutuel pooled multi-outcome markets — the implied probability of an outcome is its share of the pool, and the payout multiplier is the inverse of that share.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/` | Next.js 16 App Router frontend (React 19, Tailwind 4, TypeScript) |
| `services/api-go/` | Go HTTP API — routes, validation, CORS, graceful shutdown |
| `services/{observation,vision,forecasting,curation,qualification,operations,reputation}/` | Python pipelines, each a pure JSON-in/JSON-out CLI with a JSON Schema |
| `services/indexer/`, `services/access/` | TypeScript event codec, projector, and access policy |
| `contracts/` | Solidity interfaces and types (Foundry) |
| `database/migrations/` | PostgreSQL + TimescaleDB schema |
| `compose.yaml`, `infrastructure/` | Timescale, Redis and NATS for local development |
| `tests/` | Node test-runner suites over the TypeScript modules |

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

The frontend runs against the built-in simulator unless both `NEXT_PUBLIC_SCRY_API_URL` and `NEXT_PUBLIC_SCRY_WS_URL` are set, in which case it talks to the Go API over HTTP and WebSocket (`src/lib/api/index.ts`).

```bash
npm run lint
npx tsc --noEmit
npm test                    # TypeScript modules
npm run test:observation    # and :vision, :forecasting, :curation,
                            # :qualification, :operations, :reputation
go test ./services/api-go/...
forge test --root contracts
```

CI runs all of the above plus `docker compose config`, `npm audit` and `next build`.

## What is real and what is simulated

This matters more than anything else in the repo, because the UI is deliberately honest about it.

**Real:**

- The full frontend: routing, state, accessibility, responsive layout, keyboard navigation, offline handling, browser notifications with a service worker.
- The observation pipeline's logic — consensus clustering across observers, stream-health scoring, invalidation rules, and canonical-JSON evidence commitments (`services/observation/`).
- The vision counter's line-crossing tracker with deadband, direction filtering and stale-track eviction (`services/vision/`).
- The Go API surface: 11 routes with validation and error codes, backed by an in-memory store.
- Domain model consistency: the same eight-state market lifecycle is defined in `src/lib/domain.ts`, `services/api-go/internal/domain/models.go` and `contracts/src/ScryTypes.sol`.

**Simulated:**

- Market data. `src/lib/simulation.ts` materializes markets from the seeds in `src/lib/markets.ts` against the current clock. Markets run on rolling cycles, so there is always a live one; counts accumulate from a seeded rate, probabilities converge from the prior toward the observed evidence, and pools fill while the market is open. Everything is deterministic given `(seed, timestamp)` — the same instant always produces the same market.
- Streams. `StreamPlayer` uses LiveKit/HLS when configured and otherwise renders an SVG scene.
- Wallet and settlement. The wallet connector is real EIP-1193 against Base, but no contract is deployed, so position submission is a preview only.

**Not built yet:**

- Contract implementations. Every contract in `contracts/src/` is `abstract` — constructors and config validation only. No pooled accounting, no signature verification, no claims.
- Persistence. The migrations and `compose.yaml` exist, but nothing connects to Postgres, Redis or NATS.
- Realtime transport. `GET /v1/markets/{id}/stream` returns 501.
- Any link between the Python pipelines and the API — they are CLIs over fixtures, not running services.

## Legal note

The strategy document treats public monetary access as gated on jurisdiction-specific counsel, licensing, age controls and geofencing. The preview enforces an age and region gate on the client only, and keeps monetary participation disabled. That gate is not a compliance control.
