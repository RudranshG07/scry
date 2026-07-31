import type { Market, MarketOutcome, Observer, ProofOfObservation } from "./domain.ts";
import { challengeWindowMs, lockGraceMs, marketPhase } from "./time.ts";
import { marketSeeds, type MarketSeed } from "./markets.ts";

const minute = 60_000;

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function noise(seed: string, step: number) {
  return fnv1a(`${seed}#${step}`) / 0xffffffff;
}

export function syntheticHash(input: string): `0x${string}` {
  let digest = "";
  for (let block = 0; block < 8; block += 1) {
    digest += fnv1a(`${input}|${block}`).toString(16).padStart(8, "0");
  }
  return `0x${digest}`;
}

function clampProbability(value: number) {
  return Math.min(97, Math.max(3, Math.round(value)));
}

function cycleStartFor(seed: MarketSeed, now: number) {
  const cycle = seed.cycleMinutes * minute;
  const offset = seed.offsetMinutes * minute;
  const index = Math.floor((now - offset) / cycle) - (seed.archived ? 1 : 0);
  return index * cycle + offset;
}

function rateAt(seed: MarketSeed, cycleStart: number, step: number) {
  const wobble = 0.72 + 0.56 * noise(`${seed.id}:${cycleStart}`, step);
  return seed.baseline * seed.rateBias * wobble;
}

function countAt(seed: MarketSeed, cycleStart: number, elapsedMinutes: number) {
  const bounded = Math.max(0, Math.min(seed.observeMinutes, elapsedMinutes));
  const whole = Math.floor(bounded);
  let total = 0;
  for (let step = 0; step < whole; step += 1) {
    total += rateAt(seed, cycleStart, step);
  }
  const fraction = bounded - whole;
  if (fraction > 0) total += rateAt(seed, cycleStart, whole) * fraction;
  return total;
}

function probabilityAt(seed: MarketSeed, cycleStart: number, progress: number) {
  const prior = seed.prior / 100;
  if (progress <= 0) return clampProbability(prior * 100);
  const elapsedMinutes = progress * seed.observeMinutes;
  const projected = countAt(seed, cycleStart, elapsedMinutes) / progress;
  const margin = (projected - seed.threshold) / Math.max(1, seed.threshold * 0.18);
  const evidence = 1 / (1 + Math.exp(-margin));
  const weight = Math.min(1, progress * 1.15);
  return clampProbability((prior * (1 - weight) + evidence * weight) * 100);
}

function trendFor(seed: MarketSeed, cycleStart: number, progress: number) {
  const samples: number[] = [];
  for (let step = 0; step <= 10; step += 1) {
    samples.push(probabilityAt(seed, cycleStart, (progress * step) / 10));
  }
  return samples;
}

function outcomesFor(seed: MarketSeed, probability: number): MarketOutcome[] {
  const shares = [probability / 100, 1 - probability / 100];
  return seed.outcomes.map((outcome, index) => ({
    id: outcome.id,
    label: outcome.label,
    probability: index === 0 ? probability : 100 - probability,
    returnRate: Number((1 / Math.max(0.03, shares[index])).toFixed(2)),
  }));
}

export function materializeMarket(seed: MarketSeed, now: number): Market {
  const cycleStart = cycleStartFor(seed, now);
  const opensAt = cycleStart;
  const locksAt = opensAt + seed.openMinutes * minute;
  const observationStartsAt = locksAt + lockGraceMs;
  const observationEndsAt = locksAt + seed.observeMinutes * minute;

  const base: Market = {
    id: seed.id,
    streamId: seed.streamId,
    category: seed.category,
    location: seed.location,
    city: seed.city,
    question: seed.question,
    status: seed.invalid ? "Invalid" : "Open",
    countdown: "00:00",
    pool: seed.poolSeed,
    forecast: seed.prior,
    currentRate: seed.baseline * seed.rateBias,
    baseline: seed.baseline,
    observers: seed.observers,
    chainId: 8453,
    opensAt: new Date(opensAt).toISOString(),
    locksAt: new Date(locksAt).toISOString(),
    observationStartsAt: new Date(observationStartsAt).toISOString(),
    observationEndsAt: new Date(observationEndsAt).toISOString(),
    outcomes: outcomesFor(seed, seed.prior),
    trend: trendFor(seed, cycleStart, 0),
  };

  if (now === 0) return base;

  const phase = marketPhase(base, now);
  const progress = phase.observationProgress;
  const probability = probabilityAt(seed, cycleStart, progress);
  const observed = countAt(seed, cycleStart, progress * seed.observeMinutes);
  const openProgress = Math.min(1, Math.max(0, (now - opensAt) / Math.max(1, locksAt - opensAt)));
  const poolFill = 0.32 + 0.68 * openProgress;
  const poolJitter = 0.94 + 0.12 * noise(`${seed.id}:pool`, Math.floor(now / (5 * minute)));

  const settled = phase.status === "Resolved" || phase.status === "Invalid";
  const finalValue = Math.round(countAt(seed, cycleStart, seed.observeMinutes));
  const winningOutcomeId = finalValue > seed.threshold ? seed.outcomes[0].id : seed.outcomes[1].id;

  return {
    ...base,
    status: phase.status,
    pool: Math.round(seed.poolSeed * poolFill * poolJitter),
    forecast: seed.prior,
    currentRate: Number(rateAt(seed, cycleStart, Math.floor(progress * seed.observeMinutes)).toFixed(1)),
    observers: seed.invalid && now >= observationStartsAt ? 1 : seed.observers,
    outcomes: outcomesFor(seed, probability),
    trend: trendFor(seed, cycleStart, Math.max(0.08, progress)),
    resolvedAt: settled ? new Date(observationEndsAt + challengeWindowMs).toISOString() : undefined,
    observedValue: seed.invalid ? undefined : progress > 0 ? Math.round(observed) : undefined,
    winningOutcomeId: settled && !seed.invalid ? winningOutcomeId : undefined,
  };
}

export function listMarketsAt(now: number): Market[] {
  return marketSeeds.map((seed) => materializeMarket(seed, now));
}

export function findMarketAt(id: string, now: number): Market | null {
  const seed = marketSeeds.find((item) => item.id === id);
  return seed ? materializeMarket(seed, now) : null;
}

export function liveCountFor(market: Market, now: number) {
  const seed = marketSeeds.find((item) => item.id === market.id);
  if (!seed) return 0;
  const cycleStart = cycleStartFor(seed, now);
  const phase = marketPhase(market, now);
  return Math.round(countAt(seed, cycleStart, phase.observationProgress * seed.observeMinutes));
}

export function forecasterConsensusFor(market: Market) {
  const leading = market.outcomes[0];
  const drift = (leading.probability - market.forecast) * 0.35;
  const bias = 4 * (noise(`${market.id}:consensus`, 0) - 0.5);
  return clampProbability(leading.probability - drift + bias);
}

export function streamLatencyFor(market: Market, now: number) {
  return Math.round(620 + 340 * noise(`${market.streamId}:latency`, Math.floor(now / 4000)));
}

export function measuredUptimeFor(market: Market) {
  const seed = marketSeeds.find((item) => item.id === market.id);
  if (!seed) return 99;
  if (seed.invalid) return 96.4;
  return Number((99.1 + 0.85 * noise(`${seed.id}:uptime`, 0)).toFixed(2));
}

export function proofFor(market: Market, now: number): ProofOfObservation {
  const seed = marketSeeds.find((item) => item.id === market.id);
  const phase = marketPhase(market, now);
  const observationStartsAt = new Date(new Date(market.locksAt).getTime() + lockGraceMs).toISOString();
  const finished = phase.status === "Resolved" || phase.status === "Invalid" || phase.isPending;
  const ruleHash = syntheticHash(`rule:${market.id}:${seed?.threshold ?? 0}:${market.observationEndsAt}`);

  const observers: Observer[] = [
    {
      id: `${market.id}-edge`,
      name: "Edge log",
      role: "Edge",
      state: finished ? "Signed" : "Healthy",
      modelVersion: "edge-agent/1.4.2",
      signature: finished ? syntheticHash(`sig:edge:${market.id}`) : undefined,
    },
    {
      id: `${market.id}-vision`,
      name: "Vision primary",
      role: "Primary vision",
      state: finished ? "Signed" : "Healthy",
      modelVersion: "counter/3.8.0",
      signature: finished ? syntheticHash(`sig:vision:${market.id}`) : undefined,
    },
    {
      id: `${market.id}-verifier`,
      name: "Independent verifier",
      role: "Independent verification",
      state: market.observers < 3 ? "Disagreed" : finished ? "Signed" : "Healthy",
      modelVersion: "verifier/2.1.0",
      signature: market.observers < 3 ? undefined : finished ? syntheticHash(`sig:verify:${market.id}`) : undefined,
    },
  ];

  return {
    marketId: market.id,
    streamId: market.streamId,
    status:
      phase.status === "Invalid"
        ? "Invalid"
        : phase.status === "Resolved"
          ? "Final"
          : phase.isPending
            ? "Proposed"
            : "Collecting",
    observedValue: market.observedValue ?? null,
    winningOutcomeId: market.winningOutcomeId ?? null,
    ruleHash,
    evidenceRoot: finished ? syntheticHash(`evidence:${market.id}:${market.observationEndsAt}`) : null,
    observationWindow: {
      opensAt: observationStartsAt,
      closesAt: market.observationEndsAt,
    },
    minimumUptime: 99,
    measuredUptime: measuredUptimeFor(market),
    challengeEndsAt: finished
      ? new Date(new Date(market.observationEndsAt).getTime() + challengeWindowMs).toISOString()
      : null,
    observers,
  };
}
