import type { Tier } from "../../../shared/vote/ballot";

/** Whole dollars: a badge's share is thousands, the cents say nothing here. */
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const RING = 64;
const STROKE = 4;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;

/** On the ballot once a tier has settled: the voter's avatar ringed in gold by what is
 * left of this badge's share, and what each settled tier took from it (for good). */
export default function ShareSpent({ avatar, share, settled }: {
  /** The voter's avatar, drawn inside the ring. */
  avatar: React.ReactNode;
  /** This badge's equal share of the pool, in USD. */
  share: number;
  /** Each settled tier: how many initiatives it funded, and what this badge paid (USD). */
  settled: { tier: Tier; funded: number; paid: number }[];
}) {
  const spent = settled.reduce((a, t) => a + t.paid, 0);
  const left = Math.max(0, share - spent);
  const frac = share > 0 ? left / share : 0;
  return (
    <section
      aria-label="Your share"
      className="flex items-center gap-4 rounded-xl border border-vote/30 bg-vote/[.06] p-4"
    >
      <div
        role="meter"
        aria-label="Your share left"
        aria-valuemin={0}
        aria-valuemax={Math.round(share)}
        aria-valuenow={Math.round(left)}
        className="relative grid flex-none place-items-center"
        style={{ width: RING, height: RING }}
      >
        <svg width={RING} height={RING} className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-white/15"
          />
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            className="stroke-vote transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="grid size-[48px] place-items-center overflow-hidden rounded-full [&_img]:!size-full">
          {avatar}
        </div>
      </div>
      <div className="min-w-0 space-y-0.5">
        <p className="text-[12px] uppercase tracking-[.08em] text-white/55">Your share</p>
        <p className="font-inter-tight text-[16px] font-semibold text-white tnum">
          {dollars(left)} left of {dollars(share)}
        </p>
        {settled.map((t) => (
          <p key={t.tier} className="text-[13px] text-white/65 tnum">
            {t.paid > 0
              ? `${t.tier} paid ${dollars(t.paid)} to ${t.funded} initiative${
                t.funded === 1 ? "" : "s"
              }`
              : t.funded > 0
              ? `${t.tier} paid nothing from your share`
              : `${t.tier} funded nothing`}
          </p>
        ))}
      </div>
    </section>
  );
}
