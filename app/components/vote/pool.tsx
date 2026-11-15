import { dayTime, usdShort } from "~/lib/format";
import type { VoteManifest } from "../../../shared/vote/manifest";

/** True while the pool is ETH waiting to be sold: its dollars are an estimate. */
export const poolEstimated = (R: VoteManifest) => Boolean(R.pool && !R.pool.sold);

const eth = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ETH`;

/** "400 ETH pool (about $913K)" while it isn't sold, else "$913K pool"; `demo` for a
 * test round. `poolUsd` in dollars, the chain's now. */
export function poolName(
  R: VoteManifest,
  poolUsd: number,
  money: (n: number) => string = usdShort,
): string {
  const name = R.kind === "real" ? "pool" : "demo pool";
  return poolEstimated(R)
    ? `${eth(R.pool!.eth)} ${name} (about ${money(poolUsd)})`
    : `${money(poolUsd)} ${name}`;
}

/** Why the dollars may move: said where the pool's dollars are, while it's ETH. */
export function poolNoteText(R: VoteManifest): string | null {
  if (!poolEstimated(R)) return null;
  return `The pool is ${eth(R.pool!.eth)}, sold for dollars before the S-Tier first tally ` +
    `(${dayTime(R.schedule.firstTallyAt[0])}). Until then its dollar value is an estimate, ` +
    `and so is what a ballot must ask for.`;
}

export function PoolNote({ R, className }: { R: VoteManifest; className?: string }) {
  const text = poolNoteText(R);
  return text
    ? <p className={className ?? "m-0 text-[13px] text-white/55"} data-pool-note>{text}</p>
    : null;
}
