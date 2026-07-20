import type { FinalizedChainEvent } from "./projector.ts";

type Document = Record<string, unknown>;

function document(value: unknown): Document {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Finalized event must be an object.");
  return value as Document;
}

function text(source: Document, key: string) {
  const value = source[key];
  if (typeof value !== "string" || !value) throw new TypeError(`${key} must be a non-empty string.`);
  return value;
}

function integer(source: Document, key: string, minimum = 0) {
  const value = source[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${key} must be a safe integer of at least ${minimum}.`);
  }
  return value;
}

function unsigned(source: Document, key: string) {
  const value = text(source, key);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${key} must be an unsigned integer string.`);
  return BigInt(value);
}

function hash(source: Document, key: string) {
  const value = text(source, key);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError(`${key} must be a 32-byte hexadecimal value.`);
  return value as `0x${string}`;
}

function address(source: Document, key: string) {
  const value = text(source, key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError(`${key} must be a 20-byte hexadecimal address.`);
  return value as `0x${string}`;
}

function timestamp(source: Document, key: string) {
  const value = text(source, key);
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${key} must be a timezone-aware timestamp.`);
  }
  return value;
}

export function decodeFinalizedEvent(value: unknown): FinalizedChainEvent {
  const source = document(value);
  const type = text(source, "type");
  const base = {
    eventId: text(source, "eventId"),
    chainId: integer(source, "chainId", 1),
    blockNumber: unsigned(source, "blockNumber"),
    transactionIndex: integer(source, "transactionIndex"),
    logIndex: integer(source, "logIndex"),
    transactionHash: hash(source, "transactionHash"),
    blockHash: hash(source, "blockHash"),
    recordedAt: timestamp(source, "recordedAt"),
    marketId: text(source, "marketId"),
  };

  if (type === "market.created") {
    const outcomes = source.outcomes;
    if (!Array.isArray(outcomes) || !outcomes.length || outcomes.some((outcome) => typeof outcome !== "string" || !outcome)) {
      throw new TypeError("outcomes must be a non-empty string array.");
    }
    if (new Set(outcomes).size !== outcomes.length) throw new TypeError("outcomes must be unique.");
    const initialStatus = text(source, "initialStatus");
    if (initialStatus !== "Scheduled" && initialStatus !== "Open") throw new TypeError("initialStatus must be Scheduled or Open.");
    return {
      ...base,
      type,
      contractAddress: address(source, "contractAddress"),
      streamId: text(source, "streamId"),
      ruleHash: hash(source, "ruleHash"),
      outcomes: outcomes as string[],
      initialStatus,
    };
  }
  if (type === "position.placed" || type === "payout.claimed" || type === "refund.claimed") {
    return {
      ...base,
      type,
      account: address(source, "account"),
      outcomeId: text(source, "outcomeId"),
      amount: unsigned(source, "amount"),
    };
  }
  if (type === "observation.proposed") {
    return {
      ...base,
      type,
      observedValue: unsigned(source, "observedValue"),
      winningOutcomeId: text(source, "winningOutcomeId"),
      evidenceRoot: hash(source, "evidenceRoot"),
    };
  }
  if (type === "market.locked" || type === "market.challenged" || type === "market.resolved" || type === "market.invalidated") {
    return { ...base, type };
  }
  throw new TypeError("Finalized event type is unsupported.");
}
