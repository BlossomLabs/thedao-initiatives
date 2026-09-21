/** Role tags and vote eligibility for the community Q&A. */
import { CURATOR_ADDRESSES, MIN_VOTE_DONATION_USD } from "../config.ts";
import type { Db } from "../db/mod.ts";
import type { Chain } from "../chain/mod.ts";

export const ROLE_FAST_LANE = new Set(["ADMIN", "PROPOSER", "CURATOR", "EXPERT"]);

/** Roles shown from the current state, never stored on a comment: the team,
 * the initiative's proposer and the badge can change, and the label follows. */
export const LIVE_ROLES = new Set(["ADMIN", "PROPOSER", "EXPERT"]);

/** The order role tags are shown in; a comment carries the first two. */
export const ROLE_ORDER = ["ADMIN", "PROPOSER", "CURATOR", "EXPERT", "DONOR"];

export function liveRoles(
  admins: Set<string>,
  address: string,
  initiative: { proposer: string } | null | undefined,
  holdsBadge: boolean,
): string[] {
  const roles: string[] = [];
  if (!address) return roles;
  if (admins.has(address.toLowerCase())) roles.push("ADMIN");
  if (initiative?.proposer && initiative.proposer.toLowerCase() === address.toLowerCase()) {
    roles.push("PROPOSER");
  }
  if (holdsBadge) roles.push("EXPERT");
  return roles;
}

/** How long a page of comments waits for the chain before it goes out
 * without the EXPERT tags. The lookups finish on their own and fill the cache. */
const BADGE_WAIT_MS = 1500;

/** The badge holders among a page's commenters, lowercase: one lookup per
 * wallet, all at once. Anonymous comments have no address and are skipped. */
export async function badgeHolders(
  chain: Pick<Chain, "hasBadge">,
  addresses: string[],
): Promise<Set<string>> {
  const wallets = [...new Set(addresses.filter(Boolean).map((a) => a.toLowerCase()))];
  if (!wallets.length) return new Set();
  const held = await new Promise<boolean[]>((resolve) => {
    const timer = setTimeout(() => resolve([]), BADGE_WAIT_MS);
    Promise.all(wallets.map((a) => chain.hasBadge(a))).then((all) => {
      clearTimeout(timer);
      resolve(all);
    });
  });
  return new Set(wallets.filter((_, i) => held[i]));
}

/** The roles worth snapshotting on a comment (everything but the live ones). */
export const storedRoles = (roles: string[]) => roles.filter((r) => !LIVE_ROLES.has(r));

export function isCurator(address: string): boolean {
  const low = address.toLowerCase();
  return CURATOR_ADDRESSES.some((a) => a.toLowerCase() === low);
}

/** The wallet the initiative was submitted from (or set by an admin). */
async function isProposer(db: Db, address: string, rfpId: string): Promise<boolean> {
  const initiative = await db.initiatives.get(rfpId);
  return Boolean(initiative?.proposer) &&
    initiative!.proposer.toLowerCase() === address.toLowerCase();
}

/** Non-administrator authorization roles on THIS initiative. Callers add
 * ADMIN only from the authenticated session; live membership is display-only. */
export async function commentRoles(
  deps: { db: Db; chain: Chain },
  address: string,
  rfpId: string,
): Promise<string[]> {
  const roles: string[] = [];
  if (!address) return roles;
  if (await isProposer(deps.db, address, rfpId)) roles.push("PROPOSER");
  if (isCurator(address)) roles.push("CURATOR");
  if (await deps.chain.hasBadge(address)) roles.push("EXPERT");
  if ((await deps.db.donations.totalFor(rfpId, address)) > 0) roles.push("DONOR");
  return roles;
}

/** Non-administrator eligibility, or $20+ confirmed donations to this initiative.
 * Callers separately allow administrator-authenticated sessions. */
export async function voteEligible(
  deps: { db: Db; chain: Chain },
  address: string,
  rfpId: string,
): Promise<boolean> {
  if (!address) return false;
  if (isCurator(address)) return true;
  if (await isProposer(deps.db, address, rfpId)) return true;
  if (await deps.chain.hasBadge(address)) return true;
  return (await deps.db.donations.totalFor(rfpId, address)) >= MIN_VOTE_DONATION_USD;
}
