import { cn } from "~/lib/utils";

const TONES = {
  /** A ballot that counts. */
  good: "border-dao-green bg-dao-green/[.12] text-[#a7e3a5]",
  /** Over and kept as a record: an archived initiative. The ballot's "doesn't count" coral. */
  ended: "border-[#f08a5d] bg-[#f08a5d]/[.12] text-[#ffc2a6]",
} as const;

/** A rubber stamp beside a notice: a tilted, boxed word in capitals ("Counted", "Archived"). */
export default function Stamp(
  { tone, children, className }: {
    tone: keyof typeof TONES;
    children: React.ReactNode;
    className?: string;
  },
) {
  return (
    <span
      className={cn(
        "mt-0.5 flex-none -rotate-[4deg] rounded-lg border-2 px-2 py-0.5 font-inter-tight text-[13px] font-extrabold uppercase tracking-[.14em]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
