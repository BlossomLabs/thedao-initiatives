import { createPublicClient, type Transport } from "viem";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import { checkManifest, voteChain, type VoteManifest } from "../../shared/vote/manifest.ts";
import { manifestFromChain } from "../../shared/vote/round-from-chain.ts";
import { createStateSource, voteTransport } from "./vote-chain.ts";
import type { PinMemo } from "./vote-pinned.ts";
import { isRevert, readRoundOnChain } from "./vote-round-read.ts";

/** Configuration and replay share a head. Only the numeric initiative ID carries identity;
 * current wallet addresses are used to match newly added IDs, never existing ones. */
export async function refreshVoteManifest(
  m: VoteManifest,
  rpc: string,
  options: {
    at?: number;
    transport?: Transport;
    slugOf?: () => Promise<(account: string) => string | undefined>;
    /** The round's pin memo: a config anchor already seen canonical and since finalized
     * is not read again (it runs every few seconds per isolate). */
    finalAnchors?: PinMemo;
  } = {},
): Promise<VoteManifest> {
  const transport = options.transport ?? voteTransport(rpc);
  const pub = createPublicClient({ chain: voteChain(m), transport });
  const tip = await pub.getBlock();
  const selected = options.at !== undefined && Number(tip.timestamp) >= options.at
    ? await createStateSource({ ...m, readAt: undefined }, rpc, transport).blockBefore(options.at)
    : { block: Number(tip.number), timestamp: Number(tip.timestamp) };
  const block = selected.block === Number(tip.number)
    ? tip
    : await pub.getBlock({ blockNumber: BigInt(selected.block) });
  const head = { ...selected, hash: block.hash! };
  // The anchor is read alongside the revision (it runs every few seconds per isolate);
  // it is only used when the revision is unchanged.
  const a = m.configAnchor;
  const fin = options.finalAnchors;
  const anchorKey = a ? `${a.block}:${a.hash}` : "";
  const anchorRead = a && a.block <= head.block
    ? fin?.finalAnchors.has(anchorKey) && a.block <= fin.finalizedSeen
      ? Promise.resolve({ hash: a.hash })
      : pub.getBlock({ blockNumber: BigInt(a.block) }).then((b) => {
        // Canonical now and final: it stays canonical.
        if (fin && b.hash === a.hash && a.block <= fin.finalizedSeen) {
          fin.finalAnchors.add(anchorKey);
        }
        return b;
      })
    : undefined;
  anchorRead?.catch(() => {});
  const revision = await pub.readContract({
    address: m.contract,
    abi: SIGNED_BALLOTS_ABI,
    functionName: "configRevision",
    blockNumber: BigInt(head.block),
  }).catch((e) => {
    if (isRevert(e)) return undefined; // Older deployments have no correction setters.
    throw e;
  });
  if (revision === undefined) return { ...m, readAt: head };
  if (revision.toString() === m.configRevision && anchorRead) {
    const anchor = await anchorRead;
    if (anchor.hash === m.configAnchor!.hash) return { ...m, readAt: head };
  }
  const c = await readRoundOnChain(m.contract, rpc, transport, m.chainId, {
    block: head.block,
    deployBlock: m.deployBlock,
  });
  const slugOf = options.slugOf ? await options.slugOf() : () => undefined;
  // The CLI can replay new IDs without a board; their labels do not affect the tally.
  const names = options.slugOf ? m : {
    ...m,
    slugs: c.initiatives.map((_, i) => m.slugs[i] ?? `initiative-${i}`),
  };
  return {
    ...checkManifest(manifestFromChain(m.contract, c, slugOf, names)),
    readAt: head,
    configAnchor: { block: head.block, hash: head.hash },
  };
}
