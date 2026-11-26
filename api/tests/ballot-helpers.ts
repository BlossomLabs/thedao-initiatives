/** Ballot fixtures shared by the #149 tests: a production round holding Safes, and an
 * approved initiative with its Safe that can be put on it. */
import { assertEquals } from "@std/assert";
import { ADMIN, deploySafe, type Harness, j, proposerToken } from "./app-helpers.ts";
import { minimalSubmission } from "./fixtures.ts";
import { NO_ROUND, type VoteManifest } from "../../shared/vote/manifest.ts";
import { voteSettingKey } from "../services/vote-active.ts";

export const SAFE = "0xA000000000000000000000000000000000000001";
export const OTHER_SAFE = "0xB000000000000000000000000000000000000002";

/** The production round holding `accounts`, one project per account. */
export const production = (
  accounts: string[],
  over: Partial<VoteManifest> = {},
): VoteManifest => ({
  ...NO_ROUND,
  kind: "real",
  chainId: 1,
  badge: `0x${"34".repeat(20)}`,
  contract: `0x${"12".repeat(20)}`,
  closesAt: 4_000_000_000,
  slugs: accounts.map((_, i) => `slot-${i}`),
  accounts: accounts as `0x${string}`[],
  projects: accounts.map(() => ({ goalUsd: "25000000000", rfp: true, groups: [] })),
  ...over,
});
export const setting = (manifest: VoteManifest) => ({ round: { manifest, by: ADMIN, at: 1 } });

export const putRound = (h: Harness, m: VoteManifest) =>
  h.db.meta.set(voteSettingKey("production"), setting(m));

const GOOD = minimalSubmission(25000);

/** An approved initiative with its Safe, and helpers to put it on the production ballot. */
export async function approved(h: Harness) {
  const token = await proposerToken(h);
  const admin = await h.mint(ADMIN, true);
  const res = await h.req("/api/initiatives", { method: "POST", token, json: GOOD });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const id = (await h.db.initiatives.bySlug(slug))!.id;
  await deploySafe(h, admin, id);
  await h.req(`/api/admin/initiatives/${id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  const row = async () => (await h.db.initiatives.get(id))!;
  const putOnBallot = async (over: Partial<VoteManifest> = {}) =>
    putRound(h, production([OTHER_SAFE, (await row()).safeAddress], over));
  const patch = (json: unknown) =>
    h.req(`/api/initiatives/${slug}`, { method: "PATCH", token: admin, json });
  const edit = (json: unknown, who = token) =>
    h.req(`/api/initiatives/${slug}/revisions`, { method: "POST", token: who, json });
  const accept = (n: number) =>
    h.req(`/api/admin/initiatives/${id}/revisions/${n}/accept`, {
      method: "POST",
      token: admin,
      json: {},
    });
  return { token, admin, slug, id, row, putOnBallot, patch, edit, accept };
}

export async function onBallot(h: Harness, over: Partial<VoteManifest> = {}) {
  const x = await approved(h);
  await x.putOnBallot(over);
  return x;
}
