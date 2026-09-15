"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { scryApi } from "@/lib/api";
import { toSignableHex } from "@/lib/chain";
import { hexChainId, networkFor, parseChainId, settledNetworks, type Network } from "@/lib/networks";

type HexAddress = `0x${string}`;
type WalletStatus = "checking" | "unavailable" | "disconnected" | "connecting" | "wrong-network" | "connected" | "error";

type ProviderRequest = {
  method: string;
  params?: unknown[];
};

type EthereumProvider = {
  request<T = unknown>(request: ProviderRequest): Promise<T>;
  on?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type WalletContextValue = {
  address: HexAddress | null;
  chainId: number | null;
  networks: Network[];
  status: WalletStatus;
  error: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  switchTo: (chainId: number) => Promise<void>;
  signedInAs: HexAddress | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  provider: () => EthereumProvider | null;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function isHexAddress(value: string): value is HexAddress {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "number") return error.code;
  return null;
}

async function switchChain(provider: EthereumProvider, chainId: number) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId(chainId) }],
    });
  } catch (error) {
    const network = networkFor(chainId);
    if (errorCode(error) !== 4902 || !network) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexChainId(chainId),
          chainName: network.name,
          nativeCurrency: network.currency,
          rpcUrls: [network.rpcUrl],
          blockExplorerUrls: network.explorer ? [network.explorer] : undefined,
        },
      ],
    });
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<HexAddress | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<HexAddress | null>(null);
  const [settledChainIds, setSettledChainIds] = useState<number[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    scryApi
      .listChains(controller.signal)
      .then((chains) => setSettledChainIds(chains.map((chain) => chain.chainId)))
      .catch(() => {
        if (!controller.signal.aborted) setSettledChainIds([]);
      });
    return () => controller.abort();
  }, []);

  const networks = useMemo(() => settledNetworks(settledChainIds ?? []), [settledChainIds]);

  const syncWallet = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setAddress(null);
      setStatus("unavailable");
      return;
    }
    try {
      const [accounts, currentChain] = await Promise.all([
        provider.request<string[]>({ method: "eth_accounts" }),
        provider.request<string>({ method: "eth_chainId" }),
      ]);
      setChainId(parseChainId(currentChain));
      const nextAddress = accounts[0];
      if (!nextAddress || !isHexAddress(nextAddress)) {
        setAddress(null);
        setStatus("disconnected");
        return;
      }
      setAddress(nextAddress);
      setStatus("connected");
      setError(null);
    } catch {
      setStatus("error");
      setError("Wallet state could not be read.");
    }
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    const initialSync = window.setTimeout(() => void syncWallet(), 0);
    if (!provider?.on) return () => window.clearTimeout(initialSync);
    const handleChange = () => void syncWallet();
    provider.on("accountsChanged", handleChange);
    provider.on("chainChanged", handleChange);
    return () => {
      window.clearTimeout(initialSync);
      provider.removeListener?.("accountsChanged", handleChange);
      provider.removeListener?.("chainChanged", handleChange);
    };
  }, [syncWallet]);

  const switchTo = useCallback(async (next: number) => {
    const provider = window.ethereum;
    if (!provider) throw new Error("Install an EVM wallet to take a position.");
    await switchChain(provider, next);
    setChainId(next);
  }, []);

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setStatus("unavailable");
      setError("Install an EVM wallet to connect.");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const accounts = await provider.request<string[]>({ method: "eth_requestAccounts" });
      const nextAddress = accounts[0];
      if (!nextAddress || !isHexAddress(nextAddress)) throw new Error("Wallet returned an invalid address.");
      const current = parseChainId(await provider.request<string>({ method: "eth_chainId" }));
      const settled = networks.some((network) => network.chainId === current);
      if (!settled && networks.length > 0) await switchChain(provider, networks[0].chainId);
      setAddress(nextAddress);
      setChainId(settled || networks.length === 0 ? current : networks[0].chainId);
      setStatus("connected");
    } catch (caught) {
      setStatus("error");
      setError(errorCode(caught) === 4001 ? "Wallet connection was cancelled." : "Wallet connection failed. Try again.");
    }
  }, [networks]);

  const signIn = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider || !address) return;

    // The server writes the message; the wallet only signs it. A client-composed
    // message means signing whatever the page decided to put in front of you.
    const challenge = await scryApi.startSignIn(address);
    const signature = await provider.request<string>({
      method: "personal_sign",
      params: [toSignableHex(challenge.message), address],
    });
    const session = await scryApi.completeSignIn(address, challenge.message, signature);
    setSignedInAs(session.address as HexAddress);
  }, [address]);

  const signOut = useCallback(async () => {
    await scryApi.signOut();
    setSignedInAs(null);
  }, []);

  const offChain = status === "connected" && networks.length > 0 && !networks.some((network) => network.chainId === chainId);
  const shownStatus: WalletStatus = offChain ? "wrong-network" : status;

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      chainId,
      networks,
      status: shownStatus,
      error,
      isConnected: status === "connected" && address !== null,
      connect,
      switchTo,
      signedInAs,
      signIn,
      signOut,
      provider: () => window.ethereum ?? null,
    }),
    [address, chainId, networks, shownStatus, status, error, connect, switchTo, signedInAs, signIn, signOut],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider.");
  return value;
}
