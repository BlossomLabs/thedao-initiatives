import { useMemo } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { checkRows } from "~/components/initiative-form/ChecksCard";
import { runChecks } from "~/components/initiative-form/useChecks";
import { fromInitiative } from "~/components/initiative-form/useDraft";
import type { AdminInitiative, Pledge } from "~/lib/api-types";
import { cn } from "~/lib/utils";

/**
 * What the edit page's checks say about the initiative as it stands: the
 * reviewer reads them next to Approve. Errors block the next save of its
 * text, by the proposer or the team; warnings are for the reviewer to judge.
 */
export default function OpenPoints({ r, pledges }: { r: AdminInitiative; pledges: Pledge[] }) {
  const { rows, more, globals } = useMemo(() => {
    const found = runChecks(fromInitiative(r, pledges), "edit");
    return {
      ...checkRows(found.errors, found.warnings),
      globals: found.errors.filter((e) => !e.field),
    };
  }, [r, pledges]);
  return (
    <div className="panel">
      <span className="k">Open points</span>
      {rows.length + globals.length === 0
        ? <p className="m-0 small dim">None: the text passes every check of the edit page.</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {globals.map((g, i) => <li key={"g" + i} className="small text-[#ffd7d6]">{g.msg}</li>)}
            {rows.map((row, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-2 font-inter-tight text-[12.5px] leading-[1.45]",
                  row.kind === "err" ? "text-[#ffd7d6]" : "text-[#ffe9b8]",
                )}
              >
                {row.kind === "err"
                  ? <XCircle className="mt-[2px] size-3.5 flex-none" />
                  : <AlertTriangle className="mt-[2px] size-3.5 flex-none" />}
                <span>{row.text}</span>
              </li>
            ))}
            {more > 0 && <li className="small dim">+{more} more</li>}
          </ul>
        )}
    </div>
  );
}
