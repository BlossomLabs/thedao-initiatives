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
} from "@shared/draft/mod";
import type { Draft } from "./types";
import { liveBackers, payloadMilestones, toCheckInput } from "./useDraft";

export const LOGO_MAX_BYTES = 1024 * 1024;

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
    floor: number;
    /** Milestones add up to the goal (or there are none yet). */
    ok: boolean;
    adoptionOk: boolean;
  };
}

/** The element a finding paints: sub-fields of a list fold into the list. */
export function paintField(field: string): string {
  if (/^links_\d+$/.test(field)) return "links";
  return field;
}

/** The required questions of the scope, for "n of m answered". */
export function requiredFields(d: Draft, scope: CheckScope): string[] {
  const out: string[] = ["title", "summary"];
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

export function runChecks(d: Draft, scope: CheckScope): Findings {
  const r = checkSubmission(toCheckInput(d), scope);
  return { errors: [...r.errors, ...clientOnly(d)], warnings: r.warnings };
}

export function useChecks(
  draft: Draft,
  { submitted, serverFindings, scope = "submit" }: {
    submitted: boolean;
    serverFindings?: Findings | null;
    scope?: CheckScope;
  },
): Checks {
  return useMemo(() => {
    const all = runChecks(draft, scope);
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

    const req = requiredFields(draft, scope);
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
        floor,
        ok: rows.length === 0 || Math.round(sum) === Math.round(goal),
        adoptionOk: exempt || (goal > 0 && adoption >= floor),
      },
    };
  }, [draft, submitted, serverFindings, scope]);
}
