import { type Chain, mainnet, sepolia } from "viem/chains";
import manifest from "./manifest-data.ts";
import type { Schedule } from "./quiet-ending.ts";
import type { RulesRound } from "./rules.ts";

/** The current vote round, written by scripts/vote-deploy.ts. `slugs[i]` is
 * on-chain initiative `i`, so ballot byte `i` ranks that initiative. A test round
 * (Sepolia) mints its own badges from paper codes; the real round (mainnet) votes
 * with TheDAO's private voting badge. */
export type VoteManifest = {
  kind: "test" | "real";
  chainId: 1 | 11155111;
  contract: `0x${string}`;
  deployBlock: number;
  opensAt: number;
  /** The latest the round can end (B's last window): nothing counts from here on. */
  closesAt: number;
  /** The contract's quiet-ending schedule: tiers settle one at a time from these dates. */
  schedule: Schedule;
  /** Six-decimal USD, as a decimal string (it exceeds 2^53 in some rounds). */
  poolUsd: string;
  /** Set by admins on the Vote page, not by the deploy: the pool is this much ETH, and
   * until it's `sold` the on-chain poolUsd is only an estimate of it. */
  pool?: { eth: number; sold: boolean };
  /** Test rounds: the address that signs the paper codes; the site only ever knows this. */
  issuer?: `0x${string}`;
  /** The real round: the voting badge (the contract's eligibility NFT). */
  badge?: `0x${string}`;
  slugs: string[];
  /** Per slug, in the same order: what the contract registered (the ballot rules). */
  projects: { goalUsd: string; rfp: boolean; groups: number[] }[];
  /** Group (affiliation) names; a project's `groups` index into this. */
  groups: string[];
  /** The contract's registered currencies, in id order; [0] is the virtual USD unit.
   * Absent for rounds from before them (or test rounds): currency 0 only. */
  currencies?: { symbol: string; asset: `0x${string}`; usdFeed: `0x${string}` }[];
  /** Per slug, in the same order: the project's account on the round's chain (its Safe). */
  accounts?: `0x${string}`[];
  /** Tiers held to the independence rules: bit 0 S-Tier (always), bit 1 A-Tier. */
  independentTiers: number;
  /** Deployed with the ballot rules: the contract checks them, and so must the replay,
   * the relayer and the page. Absent for rounds from before them (the Devcon round). */
  ballotRules?: boolean;
};

export const SEPOLIA_CHAIN_ID = 11155111;
export const MAINNET_CHAIN_ID = 1;

/** Throws on a manifest the site can't run: a real round without its badge, a test
 * round without its code issuer or off Sepolia (its badges and gas drip are free). */
export function checkManifest(m: VoteManifest): VoteManifest {
  if (!m.schedule) throw new Error("vote manifest: the round needs its schedule");
  if (m.kind === "real" && !m.badge) throw new Error("vote manifest: a real round needs a badge");
  if (m.kind === "test" && !m.issuer) {
    throw new Error("vote manifest: a test round needs an issuer");
  }
  if (m.kind === "test" && m.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("vote manifest: a test round runs on Sepolia");
  }
  if (m.projects?.length !== m.slugs.length) {
    throw new Error("vote manifest: projects must match slugs one to one");
  }
  if (m.kind === "real") {
    if ((m.currencies?.length ?? 0) < 2) {
      throw new Error("vote manifest: a real round needs its currencies");
    }
    if (m.accounts?.length !== m.slugs.length) {
      throw new Error("vote manifest: accounts must match slugs one to one");
    }
  }
  for (const p of m.projects) {
    if (p.rfp && p.groups.length) throw new Error("vote manifest: an RFP can't have affiliations");
    if (p.groups.some((g) => g < 0 || g >= m.groups.length)) {
      throw new Error("vote manifest: a project names an unknown group");
    }
  }
  return m;
}

/** The round built into the site (shared/vote/manifest-data.ts). */
export const BUILT_ROUND = checkManifest(manifest as unknown as VoteManifest);

/** The round the site runs: the built-in one until the page learns the active round
 * (an admin can put a Sepolia test round in its place, `setRound`). A live binding: read
 * it when needed, never copy it at module load. */
export let ROUND: VoteManifest = BUILT_ROUND;

/** Runs the site on another round (the one /api/vote/manifest names). */
export function setRound(m: VoteManifest) {
  ROUND = checkManifest(m);
}

/** The ballot rules' view of the round: `asks[i]` is project i's ask, one per project
 * (else it throws); `poolUsd` defaults to the manifest's. */
export const rulesRound = (m: VoteManifest, asks: bigint[], poolUsd?: bigint): RulesRound => {
  if (asks.length !== m.projects.length) {
    throw new Error(`vote manifest: ${asks.length} asks for ${m.projects.length} projects`);
  }
  return {
    projects: m.projects.map((p) => ({ goalUsd: BigInt(p.goalUsd), rfp: p.rfp, groups: p.groups })),
    asks,
    groupNames: m.groups,
    poolUsd: poolUsd ?? BigInt(m.poolUsd),
    independentTiers: m.independentTiers,
  };
};

/** False while the manifest names no contract: no round, nothing to show. */
export const roundDeployed = (m: VoteManifest = ROUND): boolean => !/^0x0{40}$/i.test(m.contract);

/** The NFT whose owners vote: the voting badge, or the test round's own badges. */
export const voterNft = (m: VoteManifest): `0x${string}` =>
  m.kind === "real" ? m.badge! : m.contract;

/** The round's chain, for viem clients. */
export const voteChain = (m: VoteManifest = ROUND): Chain =>
  m.chainId === MAINNET_CHAIN_ID ? mainnet : sepolia;
