import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { api } from "~/lib/api";

type Relayer = { address: string | null; balanceWei: string | null; chainId: number };

/** Admin → Vote: the account that pays for relayed ballots, and what it has left. In
 * the real vote it stops relaying below 0.01 ETH and voters send it themselves. */
export default function VoteRelayer() {
  const q = useQuery({
    queryKey: ["admin", "vote-relayer"],
    queryFn: ({ signal }) => api<Relayer>("/api/vote/relayer", { signal }),
    refetchInterval: 60_000,
  });
  if (!q.data) return null;
  const { address, balanceWei, chainId } = q.data;
  return (
    <section className="mt-3 rounded-2xl border border-edge bg-card px-[18px] py-4">
      <span className="block font-inter-tight text-[14px] font-semibold">Vote relayer</span>
      {address && balanceWei !== null
        ? (
          <>
            <span className="block font-inter-tight text-[14px] tnum">
              {`${Number(formatEther(BigInt(balanceWei))).toFixed(4)} ETH on ${
                chainId === 1 ? "Ethereum" : "Sepolia"
              }`}
            </span>
            <span className="block break-all font-mono text-[12px] text-muted">{address}</span>
          </>
        )
        : (
          <span className="block text-[12px] text-muted">
            No relayer key is set: ballots can only be sent from the voter's wallet.
          </span>
        )}
    </section>
  );
}
