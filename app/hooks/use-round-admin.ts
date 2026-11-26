import { useQuery } from "@tanstack/react-query";
import { useWallet } from "~/context/wallet";
import { voteClient } from "~/hooks/use-vote-send";
import { useRound } from "~/lib/vote-round";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi";
import { roundDeployed } from "../../shared/vote/manifest";
import { ADMIN_ROLE_ID, PLEDGE_ROLE_ID } from "../../shared/vote/roles";

/**
 * Whether the connected wallet is a round admin: it holds both the admin and the pledge
 * role on the active round's contract (Put on the ballot, the queue's signing).
 * `canSignPledges`: it holds the pledge role, which is all the API asks of a pledge it
 * puts on-chain (without it, a save is held as Awaiting signature). Both false without a
 * wallet or a deployed round, and while the roles are being read or the read failed.
 * `hasAdminRole`: it holds the admin role, which is all `setInitiative` asks (a goal
 * change to sign, #149).
 */
export function useRoundAdmin(): {
  isRoundAdmin: boolean;
  canSignPledges: boolean;
  hasAdminRole: boolean;
  loading: boolean;
} {
  const round = useRound();
  const { address } = useWallet();
  const enabled = !!address && roundDeployed(round);
  const q = useQuery({
    queryKey: ["round-admin", round.chainId, round.contract.toLowerCase(), address?.toLowerCase()],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const pub = voteClient(round);
      const has = (role: `0x${string}`) =>
        pub.readContract({
          address: round.contract,
          abi: SIGNED_BALLOTS_ABI,
          functionName: "hasRole",
          args: [role, address as `0x${string}`],
        }) as Promise<boolean>;
      const [admin, pledge] = await Promise.all([has(ADMIN_ROLE_ID), has(PLEDGE_ROLE_ID)]);
      return { admin, pledge };
    },
  });
  return {
    isRoundAdmin: enabled && q.data?.admin === true && q.data.pledge === true,
    canSignPledges: enabled && q.data?.pledge === true,
    hasAdminRole: enabled && q.data?.admin === true,
    loading: enabled && q.isPending,
  };
}
