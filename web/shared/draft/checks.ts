import type { DraftType, Finding, Findings, Milestone, Sections } from "./types.ts";
import { FIELDS, letter, SECTIONS } from "./sections.ts";
import { usd } from "./amount.ts";
import { LIMITS } from "./normalise.ts";

export const HEDGES = /\bas needed\b|\bwhere appropriate\b/i;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_GOAL = 100_000_000;
export const MAX_DURATION_MONTHS = 120;

const HOST_RE = /^[a-z0-9.-]+$/;

/** True for an https URL with a dotted host; the only links the site renders. */
export function isHttpsUrl(raw: string): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s.length > LIMITS.LINK_CHARS) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return Boolean(host) && HOST_RE.test(host) && host.includes(".");
}

/** A third of the goal, and at least $100,000 once the goal reaches $300,000. */
export function adoptionFloor(goal: number): number {
  const g = Number(goal) || 0;
  let floor = g / 3;
  if (g >= 300_000) floor = Math.max(floor, 100_000);
  return floor;
}

export interface CheckBacker {
  org: string;
  amountUsd: number;
  url: string;
}

export interface CheckInput {
  type: DraftType;
  topup: boolean;
  page: {
    title: string;
    summary: string;
    goal: number;
    /** Whole months as typed ("" = not stated). */
    duration: string;
    recipient: string;
    recipientUrl?: string;
    funders: string;
    contact: string;
  };
  sections: Sections;
  milestones: Milestone[];
  links: string[];
  backers: CheckBacker[];
}

/** "submit": every rule. "edit": the text rules only (title, summary,
 * sections, milestones against the stored goal, links); the page facts,
 * private fields and backers are checked where they are edited. */
export type CheckScope = "submit" | "edit";

/** The same rules the form runs, on the server. Errors block; warnings are
 * the proposer's to judge. Messages match the v1 board word for word. */
export function checkSubmission(input: CheckInput, scope: CheckScope = "submit"): Findings {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const err = (field: string, msg: string, kind: Finding["kind"] = "content") =>
    errors.push({ field, msg, kind });
  const miss = (field: string, msg: string) => err(field, msg, "missing");
  const warn = (field: string, msg: string) => warnings.push({ field, msg });
  const { type, topup, page, sections, milestones, links, backers } = input;
  const full = scope === "submit";

  if ((page.title ?? "").trim().length < 8) {
    ((page.title ?? "").trim() ? err : miss)(
      "title",
      "Give the initiative a title (at least 8 characters).",
    );
  }
  if ((page.summary ?? "").trim().length < 40) {
    ((page.summary ?? "").trim() ? err : miss)(
      "summary",
      "Describe the initiative in at least 40 characters.",
    );
  }
  const goal = Number(page.goal) || 0;
  if (full && !(goal > 0 && goal <= MAX_GOAL)) {
    (goal ? err : miss)("goal", "Enter the funding goal in USD, one flat number.");
  }
  if (full) {
    const dur = (page.duration ?? "").trim();
    if (!dur) miss("duration_months", "Enter the number of months to the last milestone.");
    else if (!/^\d+$/.test(dur) || Number(dur) < 1 || Number(dur) > MAX_DURATION_MONTHS) {
      err(
        "duration_months",
        `Expected duration must be a whole number of months (1 to ${MAX_DURATION_MONTHS}).`,
      );
    }
    if (type === "grant" && !(page.recipient ?? "").trim()) {
      miss("recipient_team", "Name the team that receives this grant.");
    }
    if (type === "grant" && (page.recipientUrl ?? "").trim() && !isHttpsUrl(page.recipientUrl!)) {
      err("recipient_url", "The recipient link must be an https URL.");
    }
  }
  for (const key of SECTIONS[type]) {
    if (!(sections[key] ?? "").trim()) {
      miss(key, `${FIELDS[key].heading} is required. Answer the question above.`);
    }
  }
  for (const key of SECTIONS[type]) {
    if ((sections[key] ?? "").length > LIMITS.SECTION_CHARS) {
      err(
        key,
        `${FIELDS[key].heading} is too long (${
          LIMITS.SECTION_CHARS.toLocaleString("en-US")
        } characters at most).`,
      );
    }
  }
  if (full) {
    if ((page.funders ?? "").trim().length < 10) {
      miss("funders", "Name at least one funder, one per line. Private, never published.");
    }
    if (!(page.contact ?? "").trim()) {
      miss("contact", "An email or handle, so we can ask about this submission.");
    }
  }

  if (full) {
    backers.forEach((b, i) => {
      const amt = Number(b.amountUsd) || 0;
      if (b.org && amt <= 0) {
        err(`bk_amount_${i}`, `Add what ${b.org} committed, or remove the row.`);
      }
      if (!b.org && amt > 0) {
        err(
          `bk_org_${i}`,
          "Name the organization that committed this amount, or remove the row.",
        );
      }
      if ((b.url ?? "").trim() && !isHttpsUrl(b.url)) {
        err(`bk_url_${i}`, `${b.org || "Backer " + (i + 1)}: the link must be an https URL.`);
      }
    });
    const live = backers.filter((b) => b.org || (Number(b.amountUsd) || 0) > 0);
    if (topup && !live.length) {
      warn(
        "backers",
        "A top-up says the work is already funded by someone else. List that backer so the header can show the amount and the logo.",
      );
    }
    if (backers.length > LIMITS.BACKERS) {
      err("backers", `At most ${LIMITS.BACKERS} backers.`);
    }
  }

  if (!milestones.length) miss("milestones", "Add at least one milestone.");
  if (milestones.length > LIMITS.MILESTONES) {
    err("milestones", `At most ${LIMITS.MILESTONES} milestones.`);
  }
  let total = 0;
  let adoption = 0;
  milestones.forEach((m, i) => {
    const L = `Milestone ${letter(i)}`;
    const amt = Number(m.amount) || 0;
    total += amt;
    if (m.adoption) adoption += amt;
    if (!(m.name ?? "").trim()) miss(`ms_${i}_name`, `${L}: name this milestone.`);
    if (amt <= 0) miss(`ms_${i}_amount`, `${L}: enter what this milestone pays.`);
    const crits = (m.criteria ?? []).filter((c) => String(c).trim());
    if (!crits.length) {
      miss(`ms_${i}_crit`, `${L}: write at least one criterion a reviewer can check.`);
    }
    if (crits.length > LIMITS.CRITERIA_PER_MILESTONE) {
      err(`ms_${i}_crit`, `${L}: at most ${LIMITS.CRITERIA_PER_MILESTONE} criteria.`);
    }
    if ((m.link ?? "").trim() && !isHttpsUrl(m.link)) {
      err(`ms_${i}_link`, `${L}: the delivered-work link must be an https URL.`);
    }
    if ((m.month ?? "").trim() && !MONTH_RE.test(m.month.trim())) {
      err(`ms_${i}_month`, `${L}: the target month must look like 2026-11.`);
    }
    if (topup && m.done && !(m.link ?? "").trim()) {
      warn(`ms_${i}_link`, `${L} is marked done with no link to the delivered work.`);
    }
    if (topup && !m.done && !(m.month ?? "").trim()) {
      warn(`ms_${i}_month`, `${L} has no target month. Every remaining milestone needs one.`);
    }
    crits.forEach((c, j) => {
      const reasons: string[] = [];
      if (c.replace(/\[[^\]]*\]\([^)\s]+\)/g, "").includes("[")) {
        reasons.push("an unresolved bracket");
      }
      if (/\bTBD\b/i.test(c)) reasons.push("TBD");
      if (/PLACEHOLDER/i.test(c)) reasons.push("PLACEHOLDER");
      if (/\d+\s*-\s*\d+/.test(c)) reasons.push("a range, pick the floor");
      if (HEDGES.test(c)) reasons.push("a hedge");
      if (reasons.length) warn(`ms_${i}_c${j}`, `${L}, not checkable yet: ${reasons.join(", ")}.`);
    });
  });

  if (milestones.length && goal > 0 && Math.round(total) !== Math.round(goal)) {
    err(
      "goal",
      `Milestone amounts total ${usd(total)}, the funding goal is ${
        usd(goal)
      }. Change one of them.`,
    );
  }
  const exempt = Boolean(topup && milestones.length && milestones.every((m) => m.done));
  if (goal > 0 && milestones.length && !exempt) {
    const floor = adoptionFloor(goal);
    if (adoption === 0) {
      err(
        "milestones",
        `No milestone is an adoption milestone. Flag at least one, worth ${usd(floor)} or more.`,
      );
    } else if (adoption < floor) {
      err(
        "milestones",
        `Adoption milestones carry ${usd(adoption)}, which is ${
          Math.round(100 * adoption / goal)
        }% of the goal. Raise them to at least ${usd(floor)}.`,
      );
    }
  }

  links.forEach((l, i) => {
    if (!isHttpsUrl(l)) err(`links_${i}`, `Link ${i + 1} must be an https URL: ${l.slice(0, 60)}`);
  });
  if (links.length > LIMITS.LINKS) err("links", `At most ${LIMITS.LINKS} links.`);

  return { errors, warnings };
}
