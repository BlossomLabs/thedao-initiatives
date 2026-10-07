import type { Initiative, Session } from "../db/types.ts";
import { SESSION_REAUTH_SECS } from "../config.ts";

export function hasRecentAuth(user: Session | null | undefined, now: number): boolean {
  return Boolean(user && user.createdAt + SESSION_REAUTH_SECS > now);
}

/** Proposers retain their own data; team access to another wallet's private
 * contacts/leads requires the same fresh proof on every response path. */
export function canReadPrivateFields(
  initiative: Initiative,
  user: Session | null | undefined,
  now: number,
): boolean {
  return Boolean(
    user && (
      (initiative.proposer && initiative.proposer.toLowerCase() === user.address.toLowerCase()) ||
      (user.isAdmin && hasRecentAuth(user, now))
    ),
  );
}
