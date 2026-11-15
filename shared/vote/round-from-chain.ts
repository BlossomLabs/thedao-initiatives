import { getAddress, keccak256, slice, toBytes } from "viem";
import { SEPOLIA_CHAIN_ID, type VoteManifest } from "./manifest.ts";
import type { Schedule } from "./quiet-ending.ts";

/** A round that can't be run as read, said in words an admin can act on (safe to show:
 * no RPC detail). Anything else a read throws is not. */
export class RoundReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoundReadError";
  }
}

/** How long a tier can run: its windows, each half the one before. */
export const tierSpan = (s: { initialWindow: number; maxWindows: number }) =>
  Array.from({ length: s.maxWindows }, (_, k) => s.initialWindow >> k).reduce((a, b) => a + b, 0);

/** The account a test round registers for an initiative without a Safe (the contract
 * needs one unique account per initiative). scripts/vote-deploy.ts writes the same. */
export const testPlaceholder = (slug: string): `0x${string}` =>
  getAddress(slice(keccak256(toBytes(`test-round:${slug}`)), 12));

/** What a round's contract says about itself (read by api/services/vote-round-read.ts). */
export type RoundOnChain = {
  deployBlock: number;
  schedule: Schedule;
  poolUsd: bigint;
  independentTiers: number;
  initiatives: { account: `0x${string}`; rfp: boolean; goalUsd: bigint; groups: bigint }[];
  groups: string[];
  currencies: { symbol: string; asset: `0x${string}`; usdFeed: `0x${string}` }[];
};

/** The board initiatives an on-chain account can be: by Safe, or by a test round's
 * placeholder for its slug. */
export function slugsByAccount(rows: { slug: string; safeAddress: string }[]) {
  const by = new Map<string, string>();
  for (const r of rows) by.set(testPlaceholder(r.slug).toLowerCase(), r.slug);
  // A Safe wins over a placeholder (placeholders can't collide with real Safes in practice).
  for (const r of rows) if (r.safeAddress) by.set(r.safeAddress.toLowerCase(), r.slug);
  return (account: string) => by.get(account.toLowerCase());
}

/** The bits set in a groups mask, low first. */
const bitsOf = (mask: bigint) => {
  const out: number[] = [];
  for (let i = 0; mask >> BigInt(i) > 0n; i++) if ((mask >> BigInt(i)) & 1n) out.push(i);
  return out;
};

/**
 * A Sepolia test round's manifest from its contract: everything the deploy script would
 * write, the slugs matched through each initiative's account. Throws, naming them, when
 * an on-chain initiative matches no board initiative or two match the same one.
 */
export function manifestFromChain(
  contract: `0x${string}`,
  issuer: `0x${string}`,
  c: RoundOnChain,
  slugOf: (account: string) => string | undefined,
): VoteManifest {
  const slugs: string[] = [];
  const missing: string[] = [];
  for (const [i, x] of c.initiatives.entries()) {
    const slug = slugOf(x.account);
    if (!slug) missing.push(`#${i} (${x.account})`);
    else slugs.push(slug);
  }
  if (missing.length) {
    throw new RoundReadError(
      `No initiative on the board has the account of ${missing.join(", ")}.`,
    );
  }
  const twice = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (twice.length) throw new RoundReadError(`${twice[0]} is in the round twice.`);
  if (!c.initiatives.length) throw new RoundReadError("The round has no initiatives yet.");
  const s = c.schedule;
  return {
    kind: "test",
    chainId: SEPOLIA_CHAIN_ID,
    contract: getAddress(contract),
    deployBlock: c.deployBlock,
    opensAt: s.opensAt,
    closesAt: s.firstTallyAt[2] + tierSpan(s),
    schedule: s,
    poolUsd: c.poolUsd.toString(),
    issuer: getAddress(issuer),
    slugs,
    projects: c.initiatives.map((x) => ({
      goalUsd: x.goalUsd.toString(),
      rfp: x.rfp,
      groups: bitsOf(x.groups),
    })),
    groups: c.groups,
    currencies: c.currencies,
    accounts: c.initiatives.map((x) => getAddress(x.account)),
    independentTiers: c.independentTiers,
    ballotRules: true,
  };
}
