import manifest from "./manifest.json" with { type: "json" };

/** The DevCon round on Sepolia, written by scripts/devcon-deploy.ts. `slugs[i]` is
 * on-chain initiative `i`, so ballot byte `i` ranks that initiative. */
export type DevconManifest = {
  chainId: 11155111;
  contract: `0x${string}`;
  deployBlock: number;
  opensAt: number;
  /** Ballots and mints count only in blocks strictly before this (unix seconds). */
  closesAt: number;
  /** Six-decimal USD, as a decimal string (it exceeds 2^53 in some rounds). */
  poolUsd: string;
  /** Address that signs the paper codes; the site only ever knows this. */
  issuer: `0x${string}`;
  slugs: string[];
};

export const DEVCON = manifest as DevconManifest;

/** 2026-11-06 18:30:00 UTC: the end of 6 November in Mumbai. */
export const DEVCON_CLOSE = 1793989800;
export const SEPOLIA_CHAIN_ID = 11155111;
