/**
 * The live checks in the sidebar: how many required questions are answered,
 * the two money lines, and every finding as a jump link to its field.
 */
import { AlertTriangle, ArrowLeft, Eye, XCircle } from "lucide-react";
import { type Finding, usd } from "@shared/draft/mod";
import Bar from "~/components/ui/Bar";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { cn } from "~/lib/utils";
import { paintField } from "./useChecks";
import type { Checks } from "./useChecks";

export const CHECKS_INTRO =
  "Warnings are yours to judge, you can submit past them. Errors do not block the button: press Submit and every problem is marked on the question it belongs to.";

export const CHECKS_NOTE =
  "Required questions carry a * marker. Press Submit for review and anything still missing shows up here and on the question itself.";

const MAX_ROWS = 8;

interface Row {
  kind: "err" | "warn";
  field: string;
  text: string;
}

const CRIT_RE = /^ms_\d+_c\d+$/;

/** Findings as rows: criteria warnings grouped into one, capped with "+n more". */
export function checkRows(errors: Finding[], warnings: Finding[]): { rows: Row[]; more: number } {
  const rows: Row[] = errors.filter((e) => e.field).map((e) => ({
    kind: "err",
    field: e.field,
    text: e.msg,
  }));
  const crit = warnings.filter((w) => CRIT_RE.test(w.field));
  for (const w of warnings) {
    if (!CRIT_RE.test(w.field)) rows.push({ kind: "warn", field: w.field, text: w.msg });
  }
  if (crit.length) {
    rows.push({
      kind: "warn",
      field: crit[0].field,
      text: crit.length === 1
        ? crit[0].msg
        : `${crit.length} acceptance criteria are not checkable yet: ${
          crit.map((w) => w.msg.replace(/^Milestone (\w),.*$/, "$1")).join(", ")
        }.`,
    });
  }
  return { rows: rows.slice(0, MAX_ROWS), more: Math.max(0, rows.length - MAX_ROWS) };
}

export default function ChecksCard(
  { checks, submitted, failed, previewing, onTogglePreview, onJump, scope = "submit" }: {
    checks: Checks;
    submitted: boolean;
    /** The last submit attempt was refused (paints the border red). */
    failed: boolean;
    previewing: boolean;
    onTogglePreview: () => void;
    onJump: (field: string) => void;
    scope?: "submit" | "edit";
  },
) {
  const { errors, warnings, required, totals } = checks;
  const { rows, more } = checkRows(errors, warnings);
  const pct = required.total ? Math.round((100 * required.answered) / required.total) : 0;
  const adoptionPct = totals.goal > 0 ? Math.round((100 * totals.adoption) / totals.goal) : 0;
  const globals = errors.filter((e) => !e.field);
  return (
    <div
      className={cn(
        "panel transition-colors duration-200",
        failed && errors.length > 0 && "border-[rgba(255,59,56,.55)]",
      )}
      aria-live="polite"
    >
      <span className="k">Checks</span>
      <p className="m-0 flex items-baseline justify-between gap-3 font-inter-tight text-[14px]">
        <span>
          <b className="text-white">{required.answered}</b> of {required.total} required answered
        </span>
        <span className="small dim tnum">{pct}%</span>
      </p>
      <Bar pct={pct} className="mt-2" />
      <dl className="m-0 mt-3.5 flex flex-col divide-y divide-white/[.08] small">
        <div className="grid grid-cols-[88px_1fr] gap-x-4 py-2 first:pt-0">
          <dt className="dim">Milestones</dt>
          <dd className={cn("m-0 tnum", totals.ok ? "text-dao-green" : "text-[#ffd7d6]")}>
            {usd(totals.sum)} of {usd(totals.goal)} goal
          </dd>
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-x-4 py-2 last:pb-0">
          <dt className="dim">Adoption</dt>
          <dd className={cn("m-0 tnum", totals.adoptionOk ? "text-dao-green" : "text-[#ffd7d6]")}>
            {usd(totals.adoption)} ({adoptionPct}%), minimum {usd(totals.floor)}
          </dd>
        </div>
      </dl>

      <div className="mt-3.5 flex flex-col gap-2">
        {errors.length === 0 && (
          <Status kind="ok">
            {submitted
              ? "Nothing blocks this submission"
              : "Nothing is wrong with what is filled in so far"}
            {warnings.length ? ". You can submit past warnings, the reviewer sees them too." : "."}
          </Status>
        )}
        {globals.map((g, i) => <p key={"g" + i} className="m-0 small text-[#ffd7d6]">{g.msg}</p>)}
        {rows.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2 rounded-lg border-0 bg-transparent px-1.5 py-1 text-left font-inter-tight text-[12.5px] leading-[1.45] hover:bg-white/[.05]",
                    r.kind === "err" ? "text-[#ffd7d6]" : "text-[#ffe9b8]",
                  )}
                  onClick={() => onJump(paintField(r.field))}
                >
                  {r.kind === "err"
                    ? <XCircle className="mt-[2px] size-3.5 flex-none" />
                    : <AlertTriangle className="mt-[2px] size-3.5 flex-none" />}
                  <span>{r.text}</span>
                </button>
              </li>
            ))}
            {more > 0 && <li className="px-1.5 small dim">+{more} more</li>}
          </ul>
        )}
      </div>

      <p className="m-0 mt-3.5 small dim">{CHECKS_INTRO}</p>
      {!submitted && scope === "submit" && <p className="m-0 mt-2 small dim">{CHECKS_NOTE}</p>}

      <Button variant="ghost" className="mt-4 w-full" onClick={onTogglePreview}>
        {previewing
          ? (
            <>
              <ArrowLeft className="size-[15px]" />Back to editing
            </>
          )
          : (
            <>
              <Eye className="size-[15px]" />See it as a page
            </>
          )}
      </Button>
    </div>
  );
}
