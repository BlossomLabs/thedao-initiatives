import { useId } from "react";
import { cn } from "~/lib/utils";

/** A to-do card: a heading with its count, then rows. Says so when it is empty. */
export default function TodoSection(
  { title, count, note, empty, children, className }: {
    title: string;
    count: React.ReactNode;
    note?: React.ReactNode;
    empty: string;
    children: React.ReactNode;
    className?: string;
  },
) {
  const id = useId();
  const none = count === 0;
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-2xl border border-edge bg-card", className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pb-2.5 pt-3.5">
        <h2 id={id} className="m-0 font-inter-tight text-[15px] font-semibold">{title}</h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-inter-tight text-[12px] font-semibold tnum">
          {count}
        </span>
        {note && <span className="small dim ml-auto">{note}</span>}
      </div>
      {none
        ? <p className="m-0 border-t border-white/[.07] px-4 py-3 small dim">{empty}</p>
        : children}
    </section>
  );
}

/** One row of a to-do card: the openable part, its actions, and what opens under it. */
export function TodoRow(
  { children, className }: { children: React.ReactNode; className?: string },
) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-white/[.07] px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The row's title button: opens and closes its detail. */
export function RowToggle(
  { open, onToggle, title, meta, controls }: {
    open: boolean;
    onToggle: () => void;
    title: string;
    meta: React.ReactNode;
    controls: string;
  },
) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="-mx-1.5 -my-1 flex min-w-0 flex-[999_1_260px] cursor-pointer flex-col gap-0.5 rounded-lg border-0 bg-transparent px-1.5 py-1 text-left text-inherit hover:bg-white/5"
    >
      <span className="font-inter-tight text-[14px] font-medium">{title}</span>
      <span className="small text-white/75">{meta}</span>
    </button>
  );
}

/** What opens under a row, full width. */
export function RowDetail({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      className="flex basis-full flex-col gap-2.5 rounded-xl bg-[rgba(10,30,50,.3)] p-3.5"
    >
      {children}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {["80%", "95%", "60%"].map((w) => (
        <span
          key={w}
          className="block h-[11px] animate-pulse rounded-md bg-white/10"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}
