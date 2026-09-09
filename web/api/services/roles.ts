/** Role tags and vote eligibility for the community Q&A. */
import { CURATOR_ADDRESSES, MIN_VOTE_DONATION_USD } from "../config.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/mod.ts";
import type { Chain } from "../chain/mod.ts";

export const ROLE_FAST_LANE = new Set(["ADMIN", "CURATOR", "EXPERT"]);

export function isAdminAddress(config: Config, address: string): boolean {
  const low = address.toLowerCase();
  return config.adminAddresses.some((a) => a.toLowerCase() === low);
}

export function isCurator(address: string): boolean {
  const low = address.toLowerCase();
  return CURATOR_ADDRESSES.some((a) => a.toLowerCase() === low);
}

/** Role tags for an address on THIS initiative, snapshot at post time. */
export async function commentRoles(
  deps: { db: Db; chain: Chain; config: Config },
  address: string,
  rfpId: string,
): Promise<string[]> {
  const roles: string[] = [];
  if (!address) return roles;
  if (isAdminAddress(deps.config, address)) roles.push("ADMIN");
  if (isCurator(address)) roles.push("CURATOR");
  if (await deps.chain.hasBadge(address)) roles.push("EXPERT");
  if ((await deps.db.donations.totalFor(rfpId, address)) > 0) roles.push("DONOR");
  return roles;
}

/** A role, or $20+ confirmed donations to this same initiative. */
export async function voteEligible(
  deps: { db: Db; chain: Chain; config: Config },
  address: string,
  rfpId: string,
): Promise<boolean> {
  if (!address) return false;
  if (isAdminAddress(deps.config, address) || isCurator(address)) return true;
  if (await deps.chain.hasBadge(address)) return true;
  return (await deps.db.donations.totalFor(rfpId, address)) >= MIN_VOTE_DONATION_USD;
}
