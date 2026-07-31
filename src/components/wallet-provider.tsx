"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { scryApi } from "@/lib/api";
import { toSignableHex } from "@/lib/chain";

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
  status: WalletStatus;
  error: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  signedInAs: HexAddress | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  provider: () => EthereumProvider | null;
};

const WalletContext = createContext<WalletContextValue | null>(null);
const baseChainId = "0x2105";

function isHexAddress(value: string): value is HexAddress {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "number") return error.code;
  return null;
}

async function switchToBase(provider: EthereumProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: baseChainId }],
    });
  } catch (error) {
    if (errorCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: baseChainId,
          chainName: "Base Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://base.blockscout.com"],
        },
      ],
    });
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<HexAddress | null>(null);
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<HexAddress | null>(null);

  const syncWallet = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setAddress(null);
      setStatus("unavailable");
      return;
    }
    try {
      const [accounts, chainId] = await Promise.all([
        provider.request<string[]>({ method: "eth_accounts" }),
        provider.request<string>({ method: "eth_chainId" }),
      ]);
      const nextAddress = accounts[0];
      if (!nextAddress || !isHexAddress(nextAddress)) {
        setAddress(null);
        setStatus("disconnected");
        return;
      }
      setAddress(nextAddress);
      setStatus(chainId === baseChainId ? "connected" : "wrong-network");
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

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (!provider) {
      setStatus("unavailable");
      setError("Install an EVM wallet to connect to Base.");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const accounts = await provider.request<string[]>({ method: "eth_requestAccounts" });
      const nextAddress = accounts[0];
      if (!nextAddress || !isHexAddress(nextAddress)) throw new Error("Wallet returned an invalid address.");
      const chainId = await provider.request<string>({ method: "eth_chainId" });
      if (chainId !== baseChainId) await switchToBase(provider);
      setAddress(nextAddress);
      setStatus("connected");
    } catch (caught) {
      setStatus("error");
      setError(errorCode(caught) === 4001 ? "Wallet connection was cancelled." : "Wallet connection failed. Try again.");
    }
  }, []);

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

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      status,
      error,
      isConnected: status === "connected" && address !== null,
      connect,
      signedInAs,
      signIn,
      signOut,
      provider: () => window.ethereum ?? null,
    }),
    [address, status, error, connect, signedInAs, signIn, signOut],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider.");
  return value;
}
