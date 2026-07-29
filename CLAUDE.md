# Working in this repo

Read `README.md` first for what Scry is and which parts are real. This file covers conventions that are easy to get wrong.

## Commands

```bash
npm run dev
npm run lint          # eslint, including the React Compiler rules
npx tsc --noEmit
npm test              # node --test over tests/*.test.mjs
npm run build
```

Run `lint`, `tsc` and `test` before calling frontend work done. CI runs the Python, Go and Foundry suites too.

## Frontend conventions

- **Design tokens only.** Colors and radii come from the CSS variables in `src/app/globals.css`, surfaced as Tailwind utilities (`bg-surface`, `text-muted-foreground`, `rounded-card`). Do not write hex values or arbitrary spacing in components. `brand.md` documents the palette.
- **Buttons use the shared classes** `.button-primary`, `.button-secondary`, `.button-ghost`. Anything else interactive gets `.focus-ring`. Never `<div onClick>`.
- **Every list view implements loading, error, empty and retry.** Use skeletons, not spinners, for layout stability.
- **No comments unless the code cannot explain itself.** The codebase is deliberately comment-free; match that.
- Named exports, `type` over `interface`, full-word identifiers (`market`, not `m`).

## Time is the sharp edge

Nothing in this app should read the clock during render.

- `useNow()` from `src/lib/clock.ts` is the only clock. It is one shared interval behind `useSyncExternalStore`, and it **returns `0` on the server and during hydration**. Components must treat `0` as "unknown" and render a placeholder — `countdownFor` returns `--:--`, `deriveStatus` falls back to the seed status. This is what keeps hydration clean; do not "fix" it by calling `Date.now()` in a component.
- Market status is **derived**, never read from `market.status` in a live view. Call `marketPhase(market, now)` or `deriveStatus(market, now)` from `src/lib/time.ts`. The `status` field on a `Market` is only the value the simulator baked in at fetch time and goes stale within seconds.
- The React Compiler lint rules reject `Date.now()` in a component body and `setState` in an effect. Server components should `await scryApi.…` instead; "reset state when a prop changes" should be solved by keying the state to the prop and deriving (see `useMarketFeed`).

## Data flow

All views fetch through `scryApi` (`src/lib/api/`), never by importing market data directly. `src/hooks/use-scry.ts` wraps the API in hooks built on `useAsync`, which handles loading, error, abort, retry and background revalidation. `MockScryApi` and the eventual `HttpScryApi` both satisfy `ScryApi` in `src/lib/api/contract.ts` — keep that interface authoritative.

`src/lib/simulation.ts` is pure: same `(seed, timestamp)` in, same market out. Keep it that way so it stays testable.

## Module resolution

`tsconfig.json` sets `allowImportingTsExtensions`. Modules inside `src/lib/` import each other **relatively and with the `.ts` extension** (`import { marketPhase } from "./time.ts"`) so that `tests/*.test.mjs` can load them under `node --experimental-strip-types`. Components and hooks use the `@/` alias as normal. If you add a lib module that tests should cover, follow the relative-with-extension rule.

## Cross-language domain model

The market lifecycle exists in three places and they must agree:

- `src/lib/domain.ts` — `marketStatuses`, `marketTransitions`
- `services/api-go/internal/domain/models.go`
- `contracts/src/ScryTypes.sol` — `MarketStatus`

Changing a status or adding a field means changing all three, plus the migrations in `database/migrations/`. `tests/api-contract.test.mjs` and `tests/migrations.test.mjs` guard some of this.

## Python services

Each is a self-contained package with `schema/input.schema.json`, `schema/output.schema.json`, fixtures and unittest tests. They are pure functions over JSON — no I/O, no network, no models. Run one with `npm run test:<service>`. Keep new logic pure and schema-first.
