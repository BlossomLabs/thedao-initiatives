import { cn } from "~/lib/utils";

/** How many initiatives are new since this ballot was last sent: a round sky chip, the New
 * pill's colour: the number beside My ballot in the menu, or `words` ("3 new unplaced")
 * under Your ballot. Nothing when none. */
export default function NewCount(
  { n, words = false, className }: { n: number; words?: boolean; className?: string },
) {
  if (n <= 0) return null;
  const label = `${n} new ${n === 1 ? "initiative" : "initiatives"}`;
  if (words) {
    return (
      <span
        title={`${label} since you last sent your ballot, not placed on it`}
        className={cn(
          "inline-flex h-5 items-center whitespace-nowrap rounded-full bg-dao-sky px-2 font-inter-tight text-[11px] font-bold leading-none text-[#0b2a3d] tnum",
          className,
        )}
      >
        {n} new unplaced
      </span>
    );
  }
  return (
    <span
      title={`${label} since you last sent your ballot`}
      className={cn(
        "inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-dao-sky px-1.5 font-inter-tight text-[11px] font-bold leading-none text-[#0b2a3d] tnum",
        className,
      )}
    >
      {n}
      <span className="sr-only">{` ${n === 1 ? "new initiative" : "new initiatives"}`}</span>
    </span>
  );
}
