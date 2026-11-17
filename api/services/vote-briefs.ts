/** The vote briefs (#96): the bullets of each initiative's card on /vote. "Paid on
 * adoption" is built here from the milestones on every read; the rest is written by the
 * model only when an admin reviews the text: an approval, an accepted edit, an admin's own
 * live edit, or Rewrite summary on the initiative's admin page. Never from a view. They
 * are stored under meta, keyed to the text they were written from, so an edit makes them
 * stale instead of wrong. */
import type { Deps } from "../middleware/context.ts";
import type { Initiative } from "../db/types.ts";
import { AiError } from "./ai.ts";
import { BRIEF_FORMAT, type VoteBrief, type WhatBullet } from "../../shared/vote/brief.ts";

export const BRIEFS_META = "vote_briefs";

export interface StoredBrief {
  /** sha-256 of the model's input and BRIEF_FORMAT: the bullets stand for exactly this
   * text, written this way. */
  hash: string;
  what: WhatBullet[];
  adoption: string[];
  at: number;
}
export type StoredBriefs = Record<string, StoredBrief>;

/** What the model reads: the public text and the milestones, nothing about money raised. */
export function briefInput(r: Initiative) {
  return {
    title: r.title,
    type: r.type,
    summary: r.summary,
    // A legacy row keeps its whole text in `details` (its sections are empty).
    sections: r.details ? { details: r.details.slice(0, 8000) } : r.sections,
    milestones: r.milestones.map((m) => ({
      name: m.name,
      amount: m.amount,
      adoption: m.adoption,
      criteria: m.criteria,
    })),
  };
}

export async function inputHash(r: Initiative): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ format: BRIEF_FORMAT, ...briefInput(r) }),
  );
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One initiative's brief: its milestones' numbers and the stored lines, if any. */
export function briefOf(
  r: Initiative,
  lines: { what: WhatBullet[]; adoption: string[] } | null,
): VoteBrief {
  return {
    what: lines?.what ?? null,
    adoption: lines?.adoption ?? null,
    goalUsd: r.goalUsd,
    adoptionUsd: r.milestones.filter((m) => m.adoption).reduce((n, m) => n + m.amount, 0),
  };
}

/** Every approved initiative's brief, by slug. */
export async function buildBriefs(
  deps: Pick<Deps, "db">,
  cards: { initiative: { id: string; slug: string } }[],
): Promise<Record<string, VoteBrief>> {
  const { db } = deps;
  const stored = (await db.meta.getPublic<StoredBriefs>(BRIEFS_META)) ?? {};
  const out: Record<string, VoteBrief> = {};
  await Promise.all(cards.map(async (c) => {
    const r = await db.initiatives.get(c.initiative.id);
    if (!r) return;
    const s = stored[r.id];
    out[c.initiative.slug] = briefOf(r, s && s.hash === await inputHash(r) ? s : null);
  }));
  return out;
}

/** Admin → an initiative: its stored brief (even one written for an older text) and
 * whether it stands for the live text. */
export async function briefFor(deps: Pick<Deps, "db">, id: string) {
  const [r, stored] = await Promise.all([
    deps.db.initiatives.get(id),
    deps.db.meta.get<StoredBriefs>(BRIEFS_META),
  ]);
  const s = stored?.[id];
  if (!r || !s) return { brief: null, current: false, at: null };
  return { brief: briefOf(r, s), current: s.hash === await inputHash(r), at: s.at };
}

/** Have the model write one approved initiative's bullets for its live text, and save
 * them. Each call counts against the daily AI cap. Throws an AiError with the reason. */
export async function writeBrief(
  deps: Pick<Deps, "db" | "ai" | "now" | "log">,
  id: string,
): Promise<void> {
  const { db, ai } = deps;
  if (!ai.enabled) throw new AiError("AI is not configured");
  const r = await db.initiatives.get(id);
  if (!r || r.status !== "approved") throw new AiError("only an approved initiative has one");
  if (!(await db.meta.aiBudgetOk())) throw new AiError("today's AI call cap is reached");
  const [lines, hash] = await Promise.all([ai.voteBrief(briefInput(r)), inputHash(r)]);
  const brief: StoredBrief = { hash, ...lines, at: deps.now() };
  await db.meta.update<StoredBriefs>(BRIEFS_META, (cur) => ({ ...cur, [id]: brief }));
}

/** An admin approved the initiative, accepted an edit, or edited it live: rewrite its
 * bullets without holding up the response (one model call, ~10 s), unless they already
 * stand for its text. A failure is logged;
 * the admin's initiative page shows the bullets out of date, with Rewrite summary. */
export function rewriteBriefSoon(
  deps: Pick<Deps, "db" | "ai" | "now" | "log" | "background">,
  id: string,
): void {
  if (!deps.ai.enabled) return;
  // Nothing to do when they already stand for this text (a retag, an approval again).
  const work = briefFor(deps, id).then((b) => b.current ? undefined : writeBrief(deps, id)).catch((
    e,
  ) =>
    deps.log(
      `vote brief for ${id} failed: ${e instanceof AiError ? e.reason : String(e).slice(0, 160)}`,
    )
  );
  if (deps.background) deps.background(work);
}
