import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { dayTime, shortDay } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  isMockKind,
  isResultMockId,
  MOCK_LABELS,
  MOCK_NOW,
  type MockKind,
  momentOf,
  MOMENTS,
  RESULT_MOCKS,
} from "./mock-round";

/** The three ways to see a moment: the ballot editor, the "your ballot" page, the results. */
export type MockView = "edit" | "yours" | "results";
const VIEWS: { view: MockView; label: string }[] = [
  { view: "edit", label: "Ballot" },
  { view: "yours", label: "Your ballot" },
  { view: "results", label: "Vote results" },
];
const STEPS = ["Voting", "S-Tier", "A-Tier", "B-Tier", "Result"];
/** A moment's own ballot, named beside its variants. */
const BASE_LABEL: Partial<Record<MockKind, string>> = {
  started: "Empty ballot",
  spent: "A badge that voted",
};

/** Whether an example exists in a view: the badge that never voted and the finished vote
 * have no editor; there is no ballot to see until one counts. Every moment has results. */
export function hasView(k: MockKind, view: MockView): boolean {
  if (view === "edit") return k !== "missed" && k !== "finished";
  if (view === "yours") return !["started", "prefilled"].includes(k);
  return true;
}
export function exampleUrl(k: MockKind, view: MockView): string {
  if (view === "results") return `/vote/results/${momentOf(k)}`;
  return `/vote/mock/${k}${view === "edit" ? "/edit" : ""}`;
}
/** The example on screen, from its path. */
export function exampleAt(pathname: string): { kind: MockKind; view: MockView } | null {
  const r = pathname.match(/^\/vote\/results\/([^/]+)\/?$/);
  if (r) return isResultMockId(r[1]) ? { kind: RESULT_MOCKS[r[1]], view: "results" } : null;
  const b = pathname.match(/^\/vote\/mock\/([^/]+)(\/edit)?\/?$/);
  if (b && isMockKind(b[1])) return { kind: b[1], view: b[2] ? "edit" : "yours" };
  return null;
}
/** `k` in `view`, or the first view that has it (this one, then the editor, the ballot,
 * the results). */
function go(k: MockKind, view: MockView): string {
  const v = [view, ...VIEWS.map((x) => x.view)].find((x) => hasView(k, x))!;
  return exampleUrl(k, v);
}

const PILL =
  "rounded-full px-3 py-1.5 no-underline transition-colors aria-[current=page]:bg-white/[.14] aria-[current=page]:text-white";

/**
 * On every example page: which moment of the round it is and how it is seen. A switch for
 * the view (Ballot, Your ballot, Vote results; one an example lacks is greyed), the round's
 * steps with a dot per moment (a dot opens it in this view, or the first one it has), ‹ › to
 * step through them, and under it the moment's name and time, with its variants (a ballot
 * prefilled from ratings, a badge that never voted).
 */
export default function MockNav({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const at = exampleAt(pathname);
  if (!at) return null;
  const { kind, view } = at;
  const moment = momentOf(kind);
  const index = MOMENTS.findIndex((m) => m.kind === moment);
  const step = (d: number) => MOMENTS[index + d]?.kind;
  const prev = step(-1), next = step(1);
  const variants = MOMENTS[index].variants ?? [];
  const arrow = (to: MockKind | undefined, label: string, icon: React.ReactNode) =>
    to
      ? (
        <Link
          to={go(to, view)}
          replace
          aria-label={label}
          className="grid size-8 place-items-center rounded-full text-white/70 no-underline hover:bg-white/10 hover:text-white"
        >
          {icon}
        </Link>
      )
      : (
        <span aria-hidden="true" className="grid size-8 place-items-center text-white/20">
          {icon}
        </span>
      );

  return (
    <nav
      aria-label="Examples"
      className={cn(
        "mx-auto w-full max-w-[760px] rounded-xl border border-white/15 bg-white/[.04] p-3 text-left text-[12.5px]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="kicker m-0 text-[11px]">Example</span>
        <div role="group" aria-label="View" className="flex rounded-full bg-white/[.05] p-0.5">
          {VIEWS.map((v) =>
            hasView(kind, v.view)
              ? (
                <Link
                  key={v.view}
                  to={exampleUrl(kind, v.view)}
                  replace
                  aria-current={v.view === view ? "page" : undefined}
                  className={cn(PILL, "text-white/60 hover:text-white")}
                >
                  {v.label}
                </Link>
              )
              : (
                <span
                  key={v.view}
                  aria-disabled="true"
                  title={`No ${v.label.toLowerCase()} at this moment`}
                  className={cn(PILL, "cursor-default text-white/25")}
                >
                  {v.label}
                </span>
              )
          )}
        </div>
        <div className="ml-auto flex items-center">
          {arrow(prev, "Earlier moment", <ChevronLeft className="size-4" />)}
          {arrow(next, "Later moment", <ChevronRight className="size-4" />)}
        </div>
      </div>

      {/* The round's steps, a dot per moment in each, on one line. */}
      <ol className="relative m-0 mt-3 grid list-none grid-cols-5 p-0">
        <span aria-hidden="true" className="absolute inset-x-[10%] top-[27px] h-px bg-white/15" />
        {STEPS.map((name, s) => {
          const here = MOMENTS.filter((m) => m.step === s);
          return (
            <li key={name} className="relative flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "text-[11.5px]",
                  MOMENTS[index].step === s ? "font-semibold text-white" : "text-white/55",
                )}
              >
                {name}
              </span>
              <span className="flex items-center gap-2 px-1.5">
                {here.map((m) => {
                  const on = m.kind === moment;
                  return (
                    <Link
                      key={m.kind}
                      to={go(m.kind, view)}
                      replace
                      aria-label={`${MOCK_LABELS[m.kind]}, ${dayTime(MOCK_NOW[m.kind])}`}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "grid size-5 place-items-center rounded-full",
                        "focus-visible:outline-2 focus-visible:outline-dao-green",
                      )}
                    >
                      <span
                        className={cn(
                          "block rounded-full transition-colors",
                          on
                            ? "size-3 bg-dao-green shadow-[0_0_0_3px_rgba(92,183,90,.3)]"
                            : "size-2.5 bg-white/35 hover:bg-white/70",
                        )}
                      />
                    </Link>
                  );
                })}
              </span>
              <span className="text-[11px] text-white/40 tnum">
                {shortDay(MOCK_NOW[here[0].kind])}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-white/10 pt-2">
        <span className="text-white">
          <b className="font-semibold">{MOCK_LABELS[moment]}</b>
          <span className="ml-1.5 text-white/55">· {dayTime(MOCK_NOW[moment])}</span>
        </span>
        {view !== "results" && variants.length > 0 && (
          // The ballot's variants at this moment, beside the moment itself.
          [moment, ...variants].filter((k) => hasView(k, view) || k === kind).map((k) => (
            <Link
              key={k}
              to={go(k, view)}
              replace
              aria-current={k === kind ? "page" : undefined}
              className="rounded-full border border-white/15 px-2.5 py-0.5 text-white/60 no-underline hover:text-white aria-[current=page]:border-dao-green/60 aria-[current=page]:text-white"
            >
              {k === moment ? BASE_LABEL[moment] ?? MOCK_LABELS[k] : MOCK_LABELS[k]}
            </Link>
          ))
        )}
      </div>
    </nav>
  );
}
