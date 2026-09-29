/**
 * The live checks: the shared rules run on every change, "missing" errors
 * hidden until the first submit attempt, the server's findings (a failed
 * POST) appended until the next change.
 */
import { useMemo } from "react";
import {
  adoptionFloor,
  adoptionTotal,
  type CheckScope,
  checkSubmission,
  committedTotal,
  type Finding,
  type Findings,
  milestonesTotal,
  parseAmount,
  SECTIONS,
  usd,
} from "@shared/draft/mod";
import type { Draft } from "./types";
import { liveBackers, payloadMilestones, toCheckInput } from "./useDraft";

export const LOGO_MAX_BYTES = 1024 * 1024;

export const CATEGORY_MISSING = "Pick at least one category.";

/** `categories`: the form shows (and so requires) the categories question. */
type CheckOpts = { categories?: boolean };

export interface FieldFindings {
  errors: string[];
  warnings: string[];
}

export interface Checks {
  errors: Finding[];
  warnings: Finding[];
  /** Messages by the id the form paints (links_<i> folded into links). */
  byField: Map<string, FieldFindings>;
  required: { answered: number; total: number };
  totals: {
    sum: number;
    goal: number;
    adoption: number;
    /** What other backers committed; counted on a top-up only. */
    committed: number;
    /** What the adoption share is measured against: the goal, minus the
     * committed amount on a top-up. */
    base: number;
    floor: number;
    /** Milestones add up to the goal (or there are none yet). */
    ok: boolean;
    adoptionOk: boolean;
    /** A top-up with every milestone done, or fully covered by its backers. */
    exempt: boolean;
  };
}

/** The adoption line both totals displays print:
 * "$45,000 (34% of the $131,000 this grant raises), minimum $43,667". */
export function adoptionLine(t: Checks["totals"]): string {
  if (t.exempt && t.base <= 0) return `${usd(t.adoption)}, no adoption milestone needed`;
  const pct = t.base > 0 ? Math.round((100 * t.adoption) / t.base) : 0;
  const of = t.committed > 0 ? ` of the ${usd(t.base)} this grant raises` : "";
  return `${usd(t.adoption)} (${pct}%${of}), minimum ${usd(t.floor)}`;
}

/** The element a finding paints: sub-fields of a list fold into the list. */
export function paintField(field: string): string {
  if (/^links_\d+$/.test(field)) return "links";
  return field;
}

/** The required questions of the scope, for "n of m answered". */
export function requiredFields(d: Draft, scope: CheckScope, opts: CheckOpts = {}): string[] {
  const out: string[] = opts.categories ? ["title", "summary", "categories"] : ["title", "summary"];
  if (scope === "submit") {
    out.push("goal", "duration_months");
    if (d.type === "grant") out.push("recipient_team");
  }
  out.push(...SECTIONS[d.type]);
  out.push("milestones");
  if (scope === "submit") out.push("funders", "contact");
  return out;
}

/** Client-only rules the shared module cannot run (it never sees a File). */
function clientOnly(d: Draft): Finding[] {
  const out: Finding[] = [];
  liveBackers(d).forEach((b, i) => {
    if (b.logo && b.logo.size > LOGO_MAX_BYTES) {
      out.push({
        field: `bk_logo_${i}`,
        msg: `${b.org || "Backer " + (i + 1)}: the logo file must be under 1 MB.`,
        kind: "content",
      });
    }
  });
  return out;
}

export function runChecks(d: Draft, scope: CheckScope, opts: CheckOpts = {}): Findings {
  const r = checkSubmission(toCheckInput(d), scope);
  const cats: Finding[] = opts.categories && !d.categories.length
    ? [{ field: "categories", msg: CATEGORY_MISSING, kind: "missing" }]
    : [];
  // In form order: right after the title and summary findings.
  const at = r.errors.filter((e) => e.field === "title" || e.field === "summary").length;
  const errors = [...r.errors.slice(0, at), ...cats, ...r.errors.slice(at)];
  return { errors: [...errors, ...clientOnly(d)], warnings: r.warnings };
}

export function useChecks(
  draft: Draft,
  { submitted, serverFindings, scope = "submit", categories = false }: {
    submitted: boolean;
    serverFindings?: Findings | null;
    scope?: CheckScope;
    categories?: boolean;
  },
): Checks {
  return useMemo(() => {
    const all = runChecks(draft, scope, { categories });
    const errors = [
      ...all.errors.filter((e) => submitted || e.kind !== "missing"),
      ...(serverFindings?.errors ?? []),
    ];
    const warnings = [...all.warnings, ...(serverFindings?.warnings ?? [])];
    const byField = new Map<string, FieldFindings>();
    const at = (f: string) => {
      const k = paintField(f);
      let e = byField.get(k);
      if (!e) byField.set(k, e = { errors: [], warnings: [] });
      return e;
    };
    for (const e of errors) at(e.field).errors.push(e.msg);
    for (const w of warnings) at(w.field).warnings.push(w.msg);

    const req = requiredFields(draft, scope, { categories });
    const missing = new Set(all.errors.filter((e) => e.kind === "missing").map((e) => e.field));
    // a milestone row with an empty name, amount or criteria is not an answer
    const msMissing = [...missing].some((f) => f.startsWith("ms_"));
    const answered = req.filter((f) =>
      !missing.has(f) && !(f === "milestones" && msMissing)
    ).length;

    const rows = payloadMilestones(draft);
    const goal = parseAmount(draft.page.goal);
    const sum = milestonesTotal(rows);
    const adoption = adoptionTotal(rows);
    const committed = committedTotal(
      draft.topup,
      liveBackers(draft).map((b) => ({ amountUsd: parseAmount(b.amount) })),
    );
    const base = Math.max(0, goal - committed);
    const floor = adoptionFloor(goal, committed);
    const exempt = draft.topup && rows.length > 0 &&
      (rows.every((m) => m.done) || committed >= goal);
    return {
      errors,
      warnings,
      byField,
      required: { answered, total: req.length },
      totals: {
        sum,
        goal,
        adoption,
        committed,
        base,
        floor,
        ok: rows.length === 0 || Math.round(sum) === Math.round(goal),
        adoptionOk: exempt || (goal > 0 && adoption >= floor),
        exempt,
      },
    };
  }, [draft, submitted, serverFindings, scope, categories]);
}
