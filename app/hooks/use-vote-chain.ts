import { useCallback } from "react";
import { useWallet } from "~/context/wallet";
import { liveConnector } from "~/lib/wallet-store";
import { MAINNET_CHAIN_ID, ROUND } from "../../shared/vote/manifest";

export class WrongChainError extends Error {
  constructor(chainId: number, cause: unknown) {
    super(
      `Switch your wallet to ${chainId === MAINNET_CHAIN_ID ? "Ethereum" : "Sepolia"} to continue.`,
      { cause },
    );
  }
}

/** The round's chain (Ethereum for the real vote, Sepolia for tests): wallets refuse
 * typed data for another chain, so switch before asking for a signature or a
 * transaction. */
export function useEnsureVoteChain(target: number = ROUND.chainId): () => Promise<void> {
  const wallet = useWallet();
  const { chainId, switchChain } = wallet;
  const connector = liveConnector(wallet);
  return useCallback(async () => {
    if (chainId === target) return;
    try {
      await switchChain({ chainId: target, connector });
    } catch (e) {
      throw new WrongChainError(target, e);
    }
  }, [chainId, connector, switchChain, target]);
}
