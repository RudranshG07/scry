export type ProjectedMarketStatus =
  | "Scheduled"
  | "Open"
  | "Locked"
  | "Result proposed"
  | "Challenged"
  | "Resolved"
  | "Invalid";

type EventPosition = {
  eventId: string;
  chainId: number;
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  transactionHash: `0x${string}`;
  blockHash: `0x${string}`;
  recordedAt: string;
};

export type FinalizedChainEvent = EventPosition & (
  | {
      type: "market.created";
      marketId: string;
      contractAddress: `0x${string}`;
      streamId: string;
      ruleHash: `0x${string}`;
      outcomes: string[];
      initialStatus: "Scheduled" | "Open";
    }
  | {
      type: "position.placed";
      marketId: string;
      account: `0x${string}`;
      outcomeId: string;
      amount: bigint;
    }
  | { type: "market.locked"; marketId: string }
  | {
      type: "observation.proposed";
      marketId: string;
      observedValue: bigint;
      winningOutcomeId: string;
      evidenceRoot: `0x${string}`;
    }
  | { type: "market.challenged"; marketId: string }
  | { type: "market.resolved"; marketId: string }
  | { type: "market.invalidated"; marketId: string }
  | {
      type: "payout.claimed";
      marketId: string;
      account: `0x${string}`;
      outcomeId: string;
      amount: bigint;
    }
  | {
      type: "refund.claimed";
      marketId: string;
      account: `0x${string}`;
      outcomeId: string;
      amount: bigint;
    }
);

export type MarketProjection = {
  marketId: string;
  contractAddress: `0x${string}`;
  streamId: string;
  ruleHash: `0x${string}`;
  outcomes: string[];
  status: ProjectedMarketStatus;
  totalPool: bigint;
  poolByOutcome: Record<string, bigint>;
  observedValue: bigint | null;
  winningOutcomeId: string | null;
  evidenceRoot: `0x${string}` | null;
  updatedAt: string;
};

export type PositionProjection = {
  marketId: string;
  account: `0x${string}`;
  outcomeId: string;
  amount: bigint;
  claimedAmount: bigint;
  refundedAmount: bigint;
  updatedAt: string;
};

type ChainCursor = {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
};

export class ProjectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectorError";
  }
}

function fingerprint(event: FinalizedChainEvent) {
  return JSON.stringify(event, (_, value) => typeof value === "bigint" ? value.toString() : value);
}

function positionKey(marketId: string, account: `0x${string}`, outcomeId: string) {
  return `${marketId}:${account.toLowerCase()}:${outcomeId}`;
}

function after(cursor: ChainCursor, event: FinalizedChainEvent) {
  if (event.blockNumber !== cursor.blockNumber) return event.blockNumber > cursor.blockNumber;
  if (event.transactionIndex !== cursor.transactionIndex) return event.transactionIndex > cursor.transactionIndex;
  return event.logIndex > cursor.logIndex;
}

function requirePositiveAmount(amount: bigint) {
  if (amount <= BigInt(0)) throw new ProjectorError("Indexed amounts must be positive.");
}

export class MarketProjector {
  readonly markets = new Map<string, MarketProjection>();
  readonly positions = new Map<string, PositionProjection>();
  private readonly processedEvents = new Map<string, string>();
  private cursor: ChainCursor | null = null;
  private chainId: number | null = null;

  apply(event: FinalizedChainEvent) {
    const eventFingerprint = fingerprint(event);
    const processed = this.processedEvents.get(event.eventId);
    if (processed) {
      if (processed !== eventFingerprint) throw new ProjectorError("An event identity was reused with different data.");
      return false;
    }
    if (this.chainId !== null && event.chainId !== this.chainId) {
      throw new ProjectorError("A projector instance can only process one chain.");
    }
    if (this.cursor && !after(this.cursor, event)) {
      throw new ProjectorError("Finalized events must be applied in chain order.");
    }

    this.project(event);
    this.processedEvents.set(event.eventId, eventFingerprint);
    this.cursor = {
      blockNumber: event.blockNumber,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
    };
    this.chainId = event.chainId;
    return true;
  }

  private market(marketId: string) {
    const market = this.markets.get(marketId);
    if (!market) throw new ProjectorError("The indexed market does not exist.");
    return market;
  }

  private requireStatus(market: MarketProjection, allowed: ProjectedMarketStatus[]) {
    if (!allowed.includes(market.status)) {
      throw new ProjectorError(`Market status ${market.status} does not allow this event.`);
    }
  }

  private project(event: FinalizedChainEvent) {
    if (event.type === "market.created") {
      if (this.markets.has(event.marketId)) throw new ProjectorError("The indexed market already exists.");
      if (!event.outcomes.length || new Set(event.outcomes).size !== event.outcomes.length) {
        throw new ProjectorError("Indexed markets require unique outcomes.");
      }
      this.markets.set(event.marketId, {
        marketId: event.marketId,
        contractAddress: event.contractAddress,
        streamId: event.streamId,
        ruleHash: event.ruleHash,
        outcomes: [...event.outcomes],
        status: event.initialStatus,
        totalPool: BigInt(0),
        poolByOutcome: Object.fromEntries(event.outcomes.map((outcome) => [outcome, BigInt(0)])),
        observedValue: null,
        winningOutcomeId: null,
        evidenceRoot: null,
        updatedAt: event.recordedAt,
      });
      return;
    }

    const market = this.market(event.marketId);

    if (event.type === "position.placed") {
      this.requireStatus(market, ["Open"]);
      requirePositiveAmount(event.amount);
      if (!market.outcomes.includes(event.outcomeId)) throw new ProjectorError("The indexed outcome does not exist.");
      const key = positionKey(event.marketId, event.account, event.outcomeId);
      const existing = this.positions.get(key);
      this.positions.set(key, {
        marketId: event.marketId,
        account: event.account.toLowerCase() as `0x${string}`,
        outcomeId: event.outcomeId,
        amount: (existing?.amount ?? BigInt(0)) + event.amount,
        claimedAmount: existing?.claimedAmount ?? BigInt(0),
        refundedAmount: existing?.refundedAmount ?? BigInt(0),
        updatedAt: event.recordedAt,
      });
      market.totalPool += event.amount;
      market.poolByOutcome[event.outcomeId] += event.amount;
      market.updatedAt = event.recordedAt;
      return;
    }

    if (event.type === "market.locked") {
      this.requireStatus(market, ["Open"]);
      market.status = "Locked";
    } else if (event.type === "observation.proposed") {
      this.requireStatus(market, ["Locked"]);
      if (!market.outcomes.includes(event.winningOutcomeId)) throw new ProjectorError("The proposed outcome does not exist.");
      market.status = "Result proposed";
      market.observedValue = event.observedValue;
      market.winningOutcomeId = event.winningOutcomeId;
      market.evidenceRoot = event.evidenceRoot;
    } else if (event.type === "market.challenged") {
      this.requireStatus(market, ["Result proposed"]);
      market.status = "Challenged";
    } else if (event.type === "market.resolved") {
      this.requireStatus(market, ["Result proposed", "Challenged"]);
      market.status = "Resolved";
    } else if (event.type === "market.invalidated") {
      this.requireStatus(market, ["Scheduled", "Open", "Locked", "Result proposed", "Challenged"]);
      market.status = "Invalid";
    } else if (event.type === "payout.claimed") {
      this.requireStatus(market, ["Resolved"]);
      requirePositiveAmount(event.amount);
      if (event.outcomeId !== market.winningOutcomeId) throw new ProjectorError("Only the winning outcome can claim a payout.");
      const key = positionKey(event.marketId, event.account, event.outcomeId);
      const position = this.positions.get(key);
      if (!position) throw new ProjectorError("The indexed position does not exist.");
      position.claimedAmount += event.amount;
      position.updatedAt = event.recordedAt;
    } else if (event.type === "refund.claimed") {
      this.requireStatus(market, ["Invalid"]);
      requirePositiveAmount(event.amount);
      const key = positionKey(event.marketId, event.account, event.outcomeId);
      const position = this.positions.get(key);
      if (!position) throw new ProjectorError("The indexed position does not exist.");
      position.refundedAmount += event.amount;
      position.updatedAt = event.recordedAt;
    }
    market.updatedAt = event.recordedAt;
  }
}
