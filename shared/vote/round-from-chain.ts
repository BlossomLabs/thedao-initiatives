import { getAddress, keccak256, slice, toBytes } from "viem";
import { MAINNET_CHAIN_ID, SEPOLIA_CHAIN_ID, type VoteManifest } from "./manifest.ts";
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
  Array.from({ length: s.maxWindows }, (_, k) => Math.floor(s.initialWindow / 2 ** k)).reduce(
    (a, b) => a + b,
    0,
  );

/** The account a test round registers for an initiative without a Safe (the contract
 * needs one unique account per initiative). scripts/vote-deploy.ts writes the same. */
export const testPlaceholder = (slug: string): `0x${string}` =>
  getAddress(slice(keccak256(toBytes(`test-round:${slug}`)), 12));

/** What a round's contract says about itself (read by api/services/vote-round-read.ts). */
export type RoundOnChain = {
  chainId: number;
  /** The NFT whose owners vote: the contract itself (a test round mints its own badges),
   * or the voting badge (the real vote). */
  eligibilityNFT: `0x${string}`;
  deployBlock: number;
  configRevision?: string;
  schedule: Schedule;
  poolUsd: bigint;
  independentTiers: number;
  initiatives: { account: `0x${string}`; rfp: boolean; goalUsd: bigint; groups: bigint }[];
  groups: string[];
  currencies: {
    symbol: string;
    asset: `0x${string}`;
    usdFeed: `0x${string}`;
    disabled?: boolean;
  }[];
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
 * A round's manifest from its contract, the slugs matched through each initiative's
 * account: on Sepolia a test round (its own badges), on Ethereum the real vote (counting
 * the voting badge). Throws, naming them, when an on-chain initiative matches no board
 * initiative or two match the same one, or when the round's badges don't fit its chain.
 */
export function manifestFromChain(
  contract: `0x${string}`,
  c: RoundOnChain,
  slugOf: (account: string) => string | undefined,
  previous?: VoteManifest,
): VoteManifest {
  const same = previous?.chainId === c.chainId &&
    previous.contract.toLowerCase() === contract.toLowerCase();
  const slugs: string[] = [];
  const missing: string[] = [];
  for (const [i, x] of c.initiatives.entries()) {
    const slug = (same ? previous?.slugs[i] : undefined) ?? slugOf(x.account);
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
  const real = c.chainId === MAINNET_CHAIN_ID;
  if (!real && c.chainId !== SEPOLIA_CHAIN_ID) {
    throw new RoundReadError("A round runs on Ethereum (the real vote) or Sepolia (a test).");
  }
  const own = c.eligibilityNFT.toLowerCase() === contract.toLowerCase();
  if (real && own) {
    throw new RoundReadError(
      "That round mints its own badges: the real vote counts the voting badge.",
    );
  }
  if (!real && !own) {
    throw new RoundReadError("A test round mints its own badges; that one counts another NFT.");
  }
  const s = c.schedule;
  return {
    kind: real ? "real" : "test",
    chainId: real ? MAINNET_CHAIN_ID : SEPOLIA_CHAIN_ID,
    ...(real ? { badge: getAddress(c.eligibilityNFT) } : {}),
    contract: getAddress(contract),
    deployBlock: c.deployBlock,
    ...(c.configRevision === undefined ? {} : { configRevision: c.configRevision }),
    opensAt: s.opensAt,
    closesAt: s.firstTallyAt[2] + tierSpan(s),
    schedule: s,
    poolUsd: c.poolUsd.toString(),
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
