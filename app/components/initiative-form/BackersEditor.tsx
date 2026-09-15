/**
 * Backers already committed: optional rows that become pledges on the
 * pending initiative. The footer says what the page header will show.
 */
import { parseAmount, usd } from "@shared/draft/mod";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/utils";
import BackerRow from "./BackerRow";
import { domId, edgeClass, FieldMsg, useFinding } from "./findings";
import type { Draft } from "./types";
import { type DraftActions, liveBackers } from "./useDraft";

/** The "already committed" line of the page header, or the empty-state line. */
export function committedLine(d: Draft): { text: string; live: boolean } {
  const live = liveBackers(d);
  const total = live.reduce((a, b) => a + parseAmount(b.amount), 0);
  if (!live.length || total <= 0) {
    return {
      live: false,
      text: "Nothing committed yet, so this line stays off your page and your board card.",
    };
  }
  const goal = parseAmount(d.page.goal);
  let text = `${usd(total)} already committed by ${
    live.map((b) => b.org.trim() || "an unnamed backer").join(", ")
  }`;
  if (d.type === "grant" && d.topup && goal > total) {
    text += `; this grant raises the remaining ${usd(goal - total)}`;
  }
  return { live: true, text };
}

export default function BackersEditor(
  { draft, actions, uploads, disabled }: {
    draft: Draft;
    actions: DraftActions;
    uploads: boolean;
    disabled?: boolean;
  },
) {
  const f = useFinding("backers");
  const line = committedLine(draft);
  // findings index the live rows (what the API receives), so empty rows get ids nothing targets
  const live = liveBackers(draft);
  return (
    <div id={domId("backers")} data-field="backers" className={cn("mt-5", edgeClass(f))}>
      {draft.backers.length
        ? (
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {draft.backers.map((b, i) => (
              <BackerRow
                key={b.id}
                b={b}
                n={i + 1}
                idx={live.indexOf(b) >= 0 ? String(live.indexOf(b)) : "e" + i}
                actions={actions}
                uploads={uploads}
                disabled={disabled}
              />
            ))}
          </ol>
        )
        : (
          <p className="m-0 small dim">
            No backers listed. Add one for every organization that has already committed money to
            this work.
          </p>
        )}
      <FieldMsg field="backers" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button
          variant="ghost"
          sm
          disabled={disabled}
          onClick={() => {
            actions.addBacker();
            setTimeout(() => {
              document.querySelector<HTMLInputElement>(
                `[data-field="bk_e${draft.backers.length}"] input`,
              )
                ?.focus();
            }, 0);
          }}
        >
          Add a backer
        </Button>
        <span className={cn("small tnum", line.live ? "text-dao-green" : "dim")}>{line.text}</span>
      </div>
    </div>
  );
}
