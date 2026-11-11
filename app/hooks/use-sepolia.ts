import { useCallback } from "react";
import { useWallet } from "~/context/wallet";
import { liveConnector } from "~/lib/wallet-store";
import { SEPOLIA_CHAIN_ID } from "../../shared/vote/manifest";

export class WrongChainError extends Error {
  constructor(cause: unknown) {
    super("Switch your wallet to Sepolia to continue.", { cause });
  }
}

/** Test votes live on Sepolia: wallets refuse typed data for another chain,
 * so switch before asking for a signature or a transaction. */
export function useEnsureSepolia(): () => Promise<void> {
  const wallet = useWallet();
  const { chainId, switchChain } = wallet;
  const connector = liveConnector(wallet);
  return useCallback(async () => {
    if (chainId === SEPOLIA_CHAIN_ID) return;
    try {
      await switchChain({ chainId: SEPOLIA_CHAIN_ID, connector });
    } catch (e) {
      throw new WrongChainError(e);
    }
  }, [chainId, connector, switchChain]);
}
