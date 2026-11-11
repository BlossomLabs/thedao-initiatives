import type { Tier } from "../../../shared/vote/ballot";

/** The tier the quiet ending is settling now: its window, when it ends, and whether
 * this window has been quiet so far. */
export default function SettlingBox({ tier, window, maxWindows, endsAt, quiet }: {
  tier: Tier;
  window: number;
  maxWindows: number;
  /** When this window ends, already written out ("… UTC"). */
  endsAt: string;
  quiet: boolean;
}) {
  return (
    <section
      aria-label={`${tier} settling`}
      className="space-y-1 rounded-xl border border-white/15 bg-white/[.04] p-4"
    >
      <p className="flex items-center justify-between gap-3">
        <b className="font-inter-tight text-[15px] font-semibold text-white">
          {tier} is settling
        </b>
        <span className="rounded-full border border-white/20 px-2 py-0.5 text-[12px] text-white/70 tnum">
          Window {window} of {maxWindows}
        </span>
      </p>
      <p className="text-[13.5px] text-white/75">Ends {endsAt}</p>
      <p className="text-[13.5px] text-white/60">
        {quiet
          ? "No change so far: it settles then."
          : window >= maxWindows
          ? "It changed, but this is the last window: it settles at its end anyway."
          : "It changed in this window: a shorter window follows."}
      </p>
    </section>
  );
}
