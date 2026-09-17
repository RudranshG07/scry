"use client";

import { useCallback, useState } from "react";

import { useWallet } from "@/components/wallet-provider";
import { fromUsdc, toUsdc, type HexString } from "@/lib/abi";
import { scryApi } from "@/lib/api";
import { ScryApiError } from "@/lib/api/contract";
import { approveIfNeeded, balanceOf, claim, collateralOf, deposit, describeRevert, refund, waitForReceipt } from "@/lib/chain";
import type { Market, Position } from "@/lib/domain";
import { networkFor } from "@/lib/networks";

export type PositionStage = "idle" | "switching" | "opening" | "approving" | "depositing" | "confirming" | "done" | "failed";

export type PositionState = {
  stage: PositionStage;
  message: string;
  chainId: number | null;
  hash: string | null;
};

const idle: PositionState = { stage: "idle", message: "", chainId: null, hash: null };

export const busyStages: readonly PositionStage[] = ["switching", "opening", "approving", "depositing", "confirming"];

const deploymentPollMs = 2_000;
const deploymentAttempts = 45;

/** 4001 is the user changing their mind, not a failure. */
function rejected(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 4001;
}

function describe(error: unknown) {
  if (rejected(error)) return "Cancelled in your wallet.";
  const refusal = describeRevert(error);
  if (refusal) return refusal;
  if (error instanceof ScryApiError && error.status === 409) return "This market has locked. Positions open with the next window.";
  if (error instanceof Error) return error.message;
  return "The transaction could not be sent.";
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A market goes on chain the first time somebody wants to trade it there, so
 * the first position on each network waits a block or two for its contract. */
async function contractOn(market: Market, chainId: number): Promise<HexString> {
  const known = market.deployments.find((deployment) => deployment.chainId === chainId);
  if (known?.contractAddress) return known.contractAddress;

  let deployment = await scryApi.requestDeployment(market.id, chainId);
  for (let attempt = 0; attempt < deploymentAttempts; attempt += 1) {
    if (deployment.contractAddress) return deployment.contractAddress;
    if (deployment.state === "Failed") throw new Error("This market locked before it could open on that network.");
    await pause(deploymentPollMs);
    const latest = await scryApi.getMarket(market.id);
    deployment = latest?.deployments.find((entry) => entry.chainId === chainId) ?? deployment;
  }
  if (deployment.contractAddress) return deployment.contractAddress;
  throw new Error("The market is still opening on chain. Try again in a moment.");
}

export function usePosition(market: Market) {
  const wallet = useWallet();
  const [state, setState] = useState<PositionState>(idle);

  const take = useCallback(
    async (chainId: number, outcomeId: string, amount: string) => {
      const provider = wallet.provider();
      const account = wallet.address;
      if (!provider || !account) return false;
      const network = networkFor(chainId)?.name ?? "that network";

      let units: bigint;
      try {
        units = toUsdc(amount);
      } catch {
        setState({ ...idle, stage: "failed", message: "Enter an amount in USDC, up to six decimal places." });
        return false;
      }
      if (units === 0n) {
        setState({ ...idle, stage: "failed", message: "Enter an amount above zero." });
        return false;
      }

      try {
        if (wallet.chainId !== chainId) {
          setState({ ...idle, stage: "switching", chainId, message: `Switch your wallet to ${network}…` });
          await wallet.switchTo(chainId);
        }

        setState({ ...idle, stage: "opening", chainId, message: `Opening this market on ${network}…` });
        const book = await contractOn(market, chainId);

        const token = await collateralOf(provider, book);
        const held = await balanceOf(provider, token, account);
        if (held < units) {
          setState({ ...idle, stage: "failed", chainId, message: `This wallet holds ${fromUsdc(held)} USDC on ${network}.` });
          return false;
        }

        // One approval covers every market in this network's book, so it is
        // asked for once and each position after it is a single confirmation.
        setState({ ...idle, stage: "approving", chainId, message: "Approve USDC for Scry in your wallet…" });
        const approval = await approveIfNeeded(provider, token, account, book, units);
        if (approval) {
          setState({ stage: "approving", chainId, hash: approval, message: "Waiting for the approval to confirm…" });
          await waitForReceipt(provider, approval);
        }

        setState({ ...idle, stage: "depositing", chainId, message: "Confirm the position in your wallet…" });
        const hash = await deposit(provider, book, account, market.key, outcomeId, units);
        setState({ stage: "confirming", chainId, hash, message: "Waiting for the position to confirm…" });
        await waitForReceipt(provider, hash);

        setState({ stage: "done", chainId, hash, message: `Position confirmed on ${network}.` });
        return true;
      } catch (error) {
        setState({ ...idle, stage: "failed", chainId, message: describe(error) });
        return false;
      }
    },
    [market, wallet],
  );

  const reset = useCallback(() => setState(idle), []);

  return { state, take, reset };
}

export function useSettle() {
  const wallet = useWallet();
  const [state, setState] = useState<PositionState & { positionId: string | null }>({ ...idle, positionId: null });

  const settle = useCallback(
    async (position: Position, kind: "claim" | "refund") => {
      const provider = wallet.provider();
      const account = wallet.address;
      const contract = position.contractAddress;
      if (!provider || !account || !contract) return false;
      const chainId = position.chainId;
      const network = networkFor(chainId)?.name ?? "that network";
      const positionId = position.id;

      try {
        if (wallet.chainId !== chainId) {
          setState({ ...idle, positionId, stage: "switching", chainId, message: `Switch your wallet to ${network}…` });
          await wallet.switchTo(chainId);
        }
        setState({ ...idle, positionId, stage: "depositing", chainId, message: "Confirm in your wallet…" });
        const hash = kind === "claim"
          ? await claim(provider, contract, account, position.key)
          : await refund(provider, contract, account, position.key);
        setState({ positionId, stage: "confirming", chainId, hash, message: "Waiting for it to confirm…" });
        await waitForReceipt(provider, hash);
        setState({
          positionId,
          stage: "done",
          chainId,
          hash,
          message: kind === "claim" ? "Winnings sent to your wallet." : "Stake returned to your wallet.",
        });
        return true;
      } catch (error) {
        setState({ ...idle, positionId, stage: "failed", chainId, message: describe(error) });
        return false;
      }
    },
    [wallet],
  );

  return { state, settle };
}
