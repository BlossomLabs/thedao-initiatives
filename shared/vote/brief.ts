/** An initiative's vote brief (#96): the bullets of its card on /vote. "Paid on adoption"
 * comes from the milestones; only the "what" bullets and the adoption conditions are
 * written by a model, once per text, on the first view that finds them missing or when an
 * admin asks. */

/** The written bullets' shape. Bumped when the prompt or the shape changes: the stored
 * bullets of an older one are stale and written again. */
export const BRIEF_FORMAT = 3;

/** A "what" bullet: a short bold title, then its sentence. */
export interface WhatBullet {
  title: string;
  text: string;
}

export interface VoteBrief {
  /** What gets built or delivered, 1–3 bullets; null until written. */
  what: WhatBullet[] | null;
  /** What adoption means, 1–3 sub-bullets; null until written. */
  adoption: string[] | null;
  goalUsd: number;
  /** What the milestones flagged adoption pay, together. */
  adoptionUsd: number;
}

/** Whole dollars: "$125,000". */
const usd = (n: number) => "$" + Math.round(Math.max(0, n)).toLocaleString("en-US");
const pctOf = (part: number, whole: number) => whole > 0 ? Math.round((100 * part) / whole) : 0;

/** The last bullet: "34% ($125,000 of $370,000)". */
export function paidOnAdoption(b: Pick<VoteBrief, "adoptionUsd" | "goalUsd">): string {
  return b.adoptionUsd > 0
    ? `${pctOf(b.adoptionUsd, b.goalUsd)}% (${usd(b.adoptionUsd)} of ${usd(b.goalUsd)})`
    : "none: no milestone is flagged adoption";
}

/** "75% of goal": what the ask is of the goal, beside it on the card's header; "" without
 * a goal. */
export function ofGoal(askUsd: number, goalUsd: number): string {
  return goalUsd > 0 ? `${pctOf(askUsd, goalUsd)}% of goal` : "";
}

/** At most this many bullets of each kind, words in a title, and characters in a line. */
const MAX_WHAT = 3;
const MAX_ADOPTION = 3;
const MAX_TITLE_WORDS = 5;
const MAX_CHARS = 300;

/** One line from the model, tidied: one space between words, no bullet mark, no label it
 * kept ("Adoption:"), no quotes around it. */
const tidy = (x: unknown, label = "") =>
  typeof x !== "string" ? "" : x.replace(/\s+/g, " ").trim()
    .replace(/^[-*•]\s+/, "")
    .replace(label ? new RegExp(`^\\*{0,2}${label}\\*{0,2}\\s*:\\*{0,2}\\s*`, "i") : /^$/, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^["“]|["”]$/g, "").trim();

/** The model's reply, checked: `what` 1–3 bullets, each a title of at most 5 words and a
 * sentence; `adoption` 1–3 conditions. Every line non-empty and at most 300 characters.
 * Null when it isn't usable. */
export function cleanBriefText(
  raw: Record<string, unknown>,
): { what: WhatBullet[]; adoption: string[] } | null {
  const ok = (t: string) => t.length > 0 && t.length <= MAX_CHARS;
  const what = Array.isArray(raw.what)
    ? raw.what.map((x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { title: tidy(o.title).replace(/[:.]$/, ""), text: tidy(o.text) };
    })
    : [];
  const adoption = Array.isArray(raw.adoption)
    ? raw.adoption.map((x) => tidy(x, "Adoption"))
    : typeof raw.adoption === "string"
    ? [tidy(raw.adoption, "Adoption")]
    : [];
  const whatOk = what.length > 0 && what.length <= MAX_WHAT &&
    what.every((w) => ok(w.title) && ok(w.text) && w.title.split(" ").length <= MAX_TITLE_WORDS);
  const adoptionOk = adoption.length > 0 && adoption.length <= MAX_ADOPTION && adoption.every(ok);
  return whatOk && adoptionOk ? { what, adoption } : null;
}
