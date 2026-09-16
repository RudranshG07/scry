export type Network = {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrl: string;
  explorer: string;
  currency: { name: string; symbol: string; decimals: number };
};

const ether = { name: "Ether", symbol: "ETH", decimals: 18 };
const pol = { name: "POL", symbol: "POL", decimals: 18 };

export const networks: readonly Network[] = [
  { chainId: 8453, name: "Base", testnet: false, rpcUrl: "https://mainnet.base.org", explorer: "https://basescan.org", currency: ether },
  { chainId: 137, name: "Polygon", testnet: false, rpcUrl: "https://polygon-rpc.com", explorer: "https://polygonscan.com", currency: pol },
  { chainId: 84532, name: "Base Sepolia", testnet: true, rpcUrl: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org", currency: ether },
  { chainId: 80002, name: "Polygon Amoy", testnet: true, rpcUrl: "https://rpc-amoy.polygon.technology", explorer: "https://amoy.polygonscan.com", currency: pol },
  // Not 31337: that is every other anvil on a developer machine, and a wallet that
  // already knows it sends the deposit to whichever chain it met first.
  { chainId: 31338, name: "Scry local", testnet: true, rpcUrl: "http://127.0.0.1:8546", explorer: "", currency: ether },
];

export function networkFor(chainId: number | null | undefined): Network | null {
  return networks.find((network) => network.chainId === chainId) ?? null;
}

/** The networks Scry has contracts on, in the order they are offered. */
export function settledNetworks(chainIds: readonly number[]): Network[] {
  return networks.filter((network) => chainIds.includes(network.chainId));
}

export function hexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

export function parseChainId(value: string): number | null {
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

export function transactionUrl(chainId: number, hash: string): string | null {
  const network = networkFor(chainId);
  return network?.explorer ? `${network.explorer}/tx/${hash}` : null;
}
