"use client";

import { useCallback, useState } from "react";

import { useWallet } from "@/components/wallet-provider";
import { toUsdc } from "@/lib/abi";
import { approveIfNeeded, claim, collateralFor, deposit, refund } from "@/lib/chain";
import type { Market } from "@/lib/domain";

export type PositionStage = "idle" | "approving" | "depositing" | "done" | "failed";

export type PositionState = {
  stage: PositionStage;
  message: string;
  approvalHash: string | null;
  depositHash: string | null;
};

const idle: PositionState = { stage: "idle", message: "", approvalHash: null, depositHash: null };

/** Wallets reject with 4001 when someone changes their mind. That is not a
 * failure worth showing in red. */
function rejected(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 4001;
}

function describe(error: unknown) {
  if (rejected(error)) return "Cancelled in your wallet.";
  if (error instanceof Error) return error.message;
  return "The transaction could not be sent.";
}

export function usePosition(market: Market) {
  const wallet = useWallet();
  const [state, setState] = useState<PositionState>(idle);

  // A market that has not been deployed has no contract to escrow anything, so
  // there is nothing honest to do with a stake yet.
  const settles = Boolean(market.contractAddress);

  const take = useCallback(
    async (outcomeId: string, amount: string) => {
      const provider = wallet.provider();
      const contract = market.contractAddress;
      if (!provider || !wallet.address || !contract) return;

      let units: bigint;
      try {
        units = toUsdc(amount);
      } catch {
        setState({ ...idle, stage: "failed", message: "Enter an amount in USDC, up to six decimal places." });
        return;
      }
      if (units === 0n) {
        setState({ ...idle, stage: "failed", message: "Enter an amount above zero." });
        return;
      }

      try {
        const token = collateralFor(market.chainId);

        setState({ ...idle, stage: "approving", message: "Approving USDC…" });
        const approvalHash = await approveIfNeeded(provider, token, wallet.address, contract, units);

        setState({ stage: "depositing", message: "Confirm the position in your wallet…", approvalHash, depositHash: null });
        const depositHash = await deposit(provider, contract, wallet.address, outcomeId, units);

        setState({ stage: "done", message: "Position submitted.", approvalHash, depositHash });
      } catch (error) {
        setState({ ...idle, stage: "failed", message: describe(error) });
      }
    },
    [market.chainId, market.contractAddress, wallet],
  );

  const settle = useCallback(
    async (kind: "claim" | "refund") => {
      const provider = wallet.provider();
      const contract = market.contractAddress;
      if (!provider || !wallet.address || !contract) return;

      try {
        setState({ ...idle, stage: "depositing", message: "Confirm in your wallet…" });
        const hash = kind === "claim"
          ? await claim(provider, contract, wallet.address)
          : await refund(provider, contract, wallet.address);
        setState({
          stage: "done",
          message: kind === "claim" ? "Winnings claimed." : "Stake refunded.",
          approvalHash: null,
          depositHash: hash,
        });
      } catch (error) {
        setState({ ...idle, stage: "failed", message: describe(error) });
      }
    },
    [market.contractAddress, wallet],
  );

  const reset = useCallback(() => setState(idle), []);

  return { state, take, settle, reset, settles };
}
