import { type Chain, mainnet, sepolia } from "viem/chains";
import manifest from "./manifest-data.ts";
import type { Schedule } from "./quiet-ending.ts";

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
  /** Test rounds: the address that signs the paper codes; the site only ever knows this. */
  issuer?: `0x${string}`;
  /** The real round: the voting badge (the contract's eligibility NFT). */
  badge?: `0x${string}`;
  slugs: string[];
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
  return m;
}

export const ROUND = checkManifest(manifest as VoteManifest);

/** False while the manifest names no contract: no round, nothing to show. */
export const roundDeployed = (m: VoteManifest = ROUND): boolean => !/^0x0{40}$/i.test(m.contract);

/** The NFT whose owners vote: the voting badge, or the test round's own badges. */
export const voterNft = (m: VoteManifest): `0x${string}` =>
  m.kind === "real" ? m.badge! : m.contract;

/** The round's chain, for viem clients. */
export const voteChain = (m: VoteManifest = ROUND): Chain =>
  m.chainId === MAINNET_CHAIN_ID ? mainnet : sepolia;
