import { collect, K, type ReadOptions } from "./keys.ts";
import type { Comment, Vote } from "./types.ts";
import { newId, randomHex } from "../lib/ids.ts";

export const CLAIM_TTL_SECS = 30 * 24 * 3600;

export type CommentInput = Omit<
  Comment,
  | "id"
  | "answered"
  | "reviewed"
  | "accepted"
  | "featured"
  | "featuredAt"
  | "votes"
  | "reports"
  | "claimToken"
  | "claimExpiresAt"
  | "createdAt"
>;

export function commentsRepo(kv: Deno.Kv, now: () => number, read: ReadOptions = undefined) {
  /**
   * Insert an entry or reply. `startVote`: the author is vote-eligible, so the
   * entry starts at 1 vote (their own, so the toggle works).
   */
  async function create(input: CommentInput, startVote = false): Promise<Comment> {
    const c: Comment = {
      ...input,
      id: newId(),
      answered: false,
      reviewed: false,
      accepted: false,
      featured: 0,
      featuredAt: 0,
      votes: 0,
      reports: 0,
      claimToken: randomHex(16),
      claimExpiresAt: now() + CLAIM_TTL_SECS,
      createdAt: now(),
    };
    const op = kv.atomic().set(K.comment(c.rfpId, c.id), c).set(
      K.commentRef(c.id),
      c.rfpId,
    );
    if (c.status === "held") {
      op.set(K.claim(c.claimToken), c.id, { expireIn: CLAIM_TTL_SECS * 1000 });
    }
    if (startVote && c.address && c.parentId === null) {
      c.votes = 1;
      op.set(K.comment(c.rfpId, c.id), c);
      op.set(K.vote(c.id, c.address), { value: 1, at: now() } satisfies Vote);
    }
    await op.commit();
    return c;
  }

  async function get(id: string): Promise<Comment | null> {
    const rfpId = (await kv.get<string>(K.commentRef(id))).value;
    if (!rfpId) return null;
    return (await kv.get<Comment>(K.comment(rfpId, id))).value;
  }

  /** Published entries + replies for an initiative, oldest first. */
  async function forInitiative(rfpId: string): Promise<Comment[]> {
    const all = await collect(kv.list<Comment>({ prefix: K.comments(rfpId) }, read));
    return all.filter((c) => c.status === "published").sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Author-only view: each token unlocks exactly its own held entry. */
  async function byClaimTokens(tokens: string[]): Promise<Comment[]> {
    const out: Comment[] = [];
    for (const t of new Set(tokens)) {
      const id = (await kv.get<string>(K.claim(t))).value;
      if (!id) continue;
      const c = await get(id);
      if (
        c && c.status === "held" && c.claimToken === t &&
        (c.claimExpiresAt ?? c.createdAt + CLAIM_TTL_SECS) > now()
      ) out.push(c);
    }
    return out;
  }

  /** Explicit rotation: a valid holder replaces a claim; the old token immediately stops working. */
  async function rotateClaimToken(token: string): Promise<Comment | null> {
    const index = await kv.get<string>(K.claim(token));
    if (!index.value) return null;
    const found = await get(index.value);
    if (!found) return null;
    const row = await kv.get<Comment>(K.comment(found.rfpId, found.id));
    const c = row.value;
    if (
      !c || c.claimToken !== token || c.status !== "held" ||
      (c.claimExpiresAt ?? c.createdAt + CLAIM_TTL_SECS) <= now()
    ) return null;
    const next = { ...c, claimToken: randomHex(16), claimExpiresAt: now() + CLAIM_TTL_SECS };
    const result = await kv.atomic().check(index, row).delete(index.key)
      .set(K.claim(next.claimToken), c.id, { expireIn: CLAIM_TTL_SECS * 1000 })
      .set(row.key, next).commit();
    return result.ok ? next : null;
  }

  const ALLOWED = new Set<keyof Comment>([
    "status",
    "answered",
    "reviewed",
    "featured",
    "featuredAt",
    "aiSummary",
    "reports",
  ]);
  async function set(id: string, patch: Partial<Comment>): Promise<Comment | null> {
    for (const k of Object.keys(patch)) {
      if (!ALLOWED.has(k as keyof Comment)) throw new Error(`bad field ${k}`);
    }
    const cur = await get(id);
    if (!cur) return null;
    // Do not overwrite a claim rotation that races a moderation update.
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await kv.get<Comment>(K.comment(cur.rfpId, id));
      if (!row.value) return null;
      const next = { ...row.value, ...patch };
      const op = kv.atomic().check(row).set(row.key, next);
      if (next.status !== "held") op.delete(K.claim(row.value.claimToken));
      if ((await op.commit()).ok) return next;
    }
    throw new Error("Comment update contention");
  }

  /**
   * Set this address's vote to +1/-1; the same direction again clears it.
   * Returns {myvote, score} where score = net sum of votes.
   */
  async function setVote(
    id: string,
    address: string,
    value: 1 | -1,
  ): Promise<{ myvote: number; score: number } | null> {
    const c = await get(id);
    if (!c) return null;
    const key = K.vote(id, address);
    const existing = (await kv.get<Vote>(key)).value;
    let myvote: number;
    if (existing && existing.value === value) {
      await kv.delete(key);
      myvote = 0;
    } else {
      await kv.set(key, { value, at: now() } satisfies Vote);
      myvote = value;
    }
    const votes = await collect(kv.list<Vote>({ prefix: K.votes(id) }));
    const score = votes.reduce((s, v) => s + v.value, 0);
    const fresh = await get(id);
    if (fresh) await kv.set(K.comment(fresh.rfpId, fresh.id), { ...fresh, votes: score });
    return { myvote, score };
  }

  /** {commentId: +1/-1} for this address across an initiative's entries. */
  async function votesByAddress(
    rfpId: string,
    address: string,
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const c of await forInitiative(rfpId)) {
      const v = (await kv.get<Vote>(K.vote(c.id, address))).value;
      if (v) out[c.id] = v.value;
    }
    return out;
  }

  async function addReport(id: string): Promise<void> {
    const c = await get(id);
    if (c && c.status === "published") {
      await kv.set(K.comment(c.rfpId, c.id), { ...c, reports: c.reports + 1 });
    }
  }

  const all = () => collect(kv.list<Comment>({ prefix: ["comment"] }));

  async function held(): Promise<Comment[]> {
    return (await all()).filter((c) => c.status === "held")
      .sort((a, b) => b.reports - a.reports || a.createdAt - b.createdAt);
  }
  async function unansweredQuestions(): Promise<Comment[]> {
    return (await all()).filter((c) =>
      c.status === "published" && c.type === "question" && !c.answered &&
      c.parentId === null
    ).sort((a, b) => a.createdAt - b.createdAt);
  }
  async function reported(): Promise<Comment[]> {
    return (await all()).filter((c) => c.status === "published" && c.reports > 0)
      .sort((a, b) => b.reports - a.reports || a.createdAt - b.createdAt);
  }

  return {
    create,
    get,
    forInitiative,
    byClaimTokens,
    rotateClaimToken,
    set,
    setVote,
    votesByAddress,
    addReport,
    held,
    unansweredQuestions,
    reported,
  };
}
