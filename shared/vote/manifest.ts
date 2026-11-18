import { type Chain, mainnet, sepolia } from "viem/chains";
import type { Schedule } from "./quiet-ending.ts";
import type { RulesRound } from "./rules.ts";

/** A vote round, read from its contract (shared/vote/round-from-chain.ts) when an admin
 * sets it on Admin → Vote. `slugs[i]` is on-chain initiative `i`, so ballot byte `i`
 * ranks that initiative. A test round
 * (Sepolia) mints its own badges (admins give them, or scripts/vote-sim.ts); the real
 * round (mainnet) votes with TheDAO's private voting badge. */
export type VoteManifest = {
  kind: "test" | "real";
  chainId: 1 | 11155111;
  contract: `0x${string}`;
  deployBlock: number;
  /** Present on rounds supporting corrections. Serialized without losing uint256 precision. */
  configRevision?: string;
  /** One pinned head shared by configuration, ballots and accounting reads. */
  readAt?: { block: number; timestamp: number; hash?: `0x${string}` };
  /** Canonical block anchoring the cached configuration; detects same-revision reorgs. */
  configAnchor?: { block: number; hash: `0x${string}` };
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
  /** The real round: the voting badge (the contract's eligibility NFT). */
  badge?: `0x${string}`;
  slugs: string[];
  /** Per slug, in the same order: what the contract registered (the ballot rules). */
  projects: { goalUsd: string; rfp: boolean; groups: number[] }[];
  /** Group (affiliation) names; a project's `groups` index into this. */
  groups: string[];
  /** The contract's registered currencies, in id order; [0] is the virtual USD unit.
   * Absent for rounds from before them (or test rounds): currency 0 only. */
  currencies?: {
    symbol: string;
    asset: `0x${string}`;
    usdFeed: `0x${string}`;
    disabled?: boolean;
  }[];
  /** Per slug, in the same order: the project's account on the round's chain (its Safe). */
  accounts?: `0x${string}`[];
  /** Tiers held to the independence rules: bit 0 S-Tier (always), bit 1 A-Tier. */
  independentTiers: number;
  /** Deployed with the ballot rules: the contract checks them, and so must the replay,
   * the relayer and the page. Absent for rounds from before them (the Devcon round). */
  ballotRules?: boolean;
};

/** The initiatives on the ballot: the production (real) round's slugs. A test round, or
 * no round, puts nothing on it. Derived, never stored. */
export const onBallotSlugs = (m: VoteManifest | undefined): Set<string> =>
  new Set(m?.kind === "real" ? m.slugs : []);

export const SEPOLIA_CHAIN_ID = 11155111;
export const MAINNET_CHAIN_ID = 1;

/** Throws on a manifest the site can't run: a real round without its badge, a test
 * round off Sepolia (its badges and gas drip are free). */
export function checkManifest(m: VoteManifest): VoteManifest {
  if (!m.schedule) throw new Error("vote manifest: the round needs its schedule");
  if (m.kind === "real" && !m.badge) throw new Error("vote manifest: a real round needs a badge");
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

/** No round: what the site runs until it learns the one an admin set (`roundDeployed`
 * is false for it). */
export const NO_ROUND: VoteManifest = {
  kind: "test",
  chainId: SEPOLIA_CHAIN_ID,
  contract: "0x0000000000000000000000000000000000000000",
  deployBlock: 0,
  opensAt: 0,
  closesAt: 0,
  schedule: { opensAt: 0, firstTallyAt: [0, 0, 0], initialWindow: 0, maxWindows: 0 },
  poolUsd: "0",
  slugs: [],
  projects: [],
  groups: [],
  independentTiers: 1,
};

/** The ballot rules' view of the round: `asks[i]` is project i's ask, one per project
 * (else it throws); `poolUsd` defaults to the manifest's; `withdrawn` names the projects
 * an admin withdrew, by index (each asks $0 for the size rule). */
export const rulesRound = (
  m: VoteManifest,
  asks: bigint[],
  poolUsd?: bigint,
  withdrawn?: readonly number[],
): RulesRound => {
  if (asks.length !== m.projects.length) {
    throw new Error(`vote manifest: ${asks.length} asks for ${m.projects.length} projects`);
  }
  return {
    projects: m.projects.map((p) => ({ goalUsd: BigInt(p.goalUsd), rfp: p.rfp, groups: p.groups })),
    asks,
    groupNames: m.groups,
    poolUsd: poolUsd ?? BigInt(m.poolUsd),
    ...(withdrawn ? { withdrawn: m.projects.map((_, i) => withdrawn.includes(i)) } : {}),
    independentTiers: m.independentTiers,
  };
};

/** False while the manifest names no contract: no round, nothing to show. */
export const roundDeployed = (m: VoteManifest): boolean => !/^0x0{40}$/i.test(m.contract);

/** The NFT whose owners vote: the voting badge, or the test round's own badges. */
export const voterNft = (m: VoteManifest): `0x${string}` =>
  m.kind === "real" ? m.badge! : m.contract;

/** The round's chain, for viem clients. */
export const voteChain = (m: VoteManifest): Chain =>
  m.chainId === MAINNET_CHAIN_ID ? mainnet : sepolia;
