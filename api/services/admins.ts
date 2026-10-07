/**
 * Who is an admin: the addresses in ADMIN_ADDRESSES (fixed, only the env
 * can change them) plus the ones added from the admin dashboard, kept in KV.
 * Display tags use a short-lived snapshot; authorization reads current KV
 * membership on every check. Membership changes invalidate the wallet's
 * sessions, and new administrator access always requires fresh authentication.
 */
import type { Db } from "../db/mod.ts";
import type { Config } from "../config.ts";
import { HttpError } from "../lib/errors.ts";
import { addrEq, isAddress, toChecksum } from "../chain/address.ts";

export const ADMINS_META_KEY = "admins";
const SNAPSHOT_TTL_SECS = 5;

export interface AdminEntry {
  address: string;
  /** Set in ADMIN_ADDRESSES: shown, never removable from the dashboard. */
  fixed: boolean;
}

export function createAdmins(db: Db, config: Config, now: () => number) {
  const fixed = config.adminAddresses;
  const isFixed = (a: string) => fixed.some((f) => addrEq(f, a));
  let snapshot: { set: Set<string>; at: number } | null = null;

  const added = async (): Promise<string[]> => (await db.meta.get<string[]>(ADMINS_META_KEY)) ?? [];

  async function set(): Promise<Set<string>> {
    if (snapshot && now() - snapshot.at < SNAPSHOT_TTL_SECS) return snapshot.set;
    const all = new Set([...fixed, ...(await added())].map((a) => a.toLowerCase()));
    snapshot = { set: all, at: now() };
    return all;
  }

  async function isAdmin(address: string): Promise<boolean> {
    if (!address) return false;
    if (isFixed(address)) return true;
    // Never authorize from the display cache: another instance may have just
    // removed this wallet while an authentication request was in flight.
    return (await added()).some((a) => addrEq(a, address));
  }

  async function list(): Promise<AdminEntry[]> {
    const extra = (await added()).filter((a) => !isFixed(a));
    return [
      ...fixed.map((address) => ({ address, fixed: true })),
      ...extra.map((address) => ({ address, fixed: false })),
    ];
  }

  async function add(raw: string): Promise<AdminEntry[]> {
    if (!isAddress(raw)) throw new HttpError(400, "that is not an Ethereum address");
    const address = toChecksum(raw);
    if (isFixed(address)) throw new HttpError(409, "already an admin");
    await db.meta.update<string[]>(ADMINS_META_KEY, (current) => {
      const cur = current ?? [];
      if (cur.some((a) => addrEq(a, address))) throw new HttpError(409, "already an admin");
      return [...cur, address];
    });
    snapshot = null;
    await db.sessions.revokeAll(address);
    return list();
  }

  async function remove(raw: string, by: string): Promise<AdminEntry[]> {
    if (!isAddress(raw)) throw new HttpError(400, "that is not an Ethereum address");
    if (isFixed(raw)) {
      throw new HttpError(400, "set in ADMIN_ADDRESSES; change the env var to remove it");
    }
    if (addrEq(raw, by)) throw new HttpError(400, "you cannot remove yourself");
    await db.meta.update<string[]>(ADMINS_META_KEY, (current) => {
      const cur = current ?? [];
      const next = cur.filter((a) => !addrEq(a, raw));
      if (next.length === cur.length) throw new HttpError(404, "not an admin");
      return next;
    });
    snapshot = null;
    await db.sessions.revokeAll(raw);
    return list();
  }

  return { isAdmin, set, list, add, remove };
}

export type Admins = ReturnType<typeof createAdmins>;
