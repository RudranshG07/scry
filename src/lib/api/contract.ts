import type {
  Category,
  LeaderboardEntry,
  Market,
  MarketStatus,
  MarketUpdate,
  Portfolio,
  ProofOfObservation,
  RoomMessage,
  CreateRoomMessage,
  ScryNotification,
} from "@/lib/domain";

export type MarketQuery = {
  category?: Category;
  status?: MarketStatus;
  signal?: AbortSignal;
};

export type SignInChallenge = {
  nonce: string;
  issuedAt: string;
  message: string;
};

export type Session = {
  address: `0x${string}`;
  expiresAt: string;
};

export type MarketSubscription = {
  onEvent: (event: MarketUpdate) => void;
  onError: (error: Error) => void;
};

export interface ScryApi {
  listMarkets(query?: MarketQuery): Promise<Market[]>;
  getMarket(id: string, signal?: AbortSignal): Promise<Market | null>;
  getProof(marketId: string, signal?: AbortSignal): Promise<ProofOfObservation | null>;
  getPortfolio(address: `0x${string}`, signal?: AbortSignal): Promise<Portfolio>;
  getLeaderboard(signal?: AbortSignal): Promise<LeaderboardEntry[]>;
  getRoomMessages(marketId: string, signal?: AbortSignal): Promise<RoomMessage[]>;
  postRoomMessage(marketId: string, message: CreateRoomMessage, signal?: AbortSignal): Promise<RoomMessage>;
  getNotifications(address?: `0x${string}`, signal?: AbortSignal): Promise<ScryNotification[]>;
  subscribeToMarket(marketId: string, subscription: MarketSubscription): () => void;
  startSignIn(address: `0x${string}`): Promise<SignInChallenge>;
  completeSignIn(address: `0x${string}`, message: string, signature: string): Promise<Session>;
  currentSession(signal?: AbortSignal): Promise<Session | null>;
  signOut(): Promise<void>;
}

export class ScryApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ScryApiError";
    this.status = status;
  }
}
