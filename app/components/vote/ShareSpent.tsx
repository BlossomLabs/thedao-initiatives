import type { Tier } from "../../../shared/vote/ballot";

/** Whole dollars: a badge's share is thousands, the cents say nothing here. */
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const and = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** On the ballot once a tier has settled: this badge's share of the pool, what it
 * paid in each settled tier (for good: those initiatives are funded), and what is left
 * for the tiers still open. */
export default function ShareSpent({ share, settled, open }: {
  /** This badge's equal share of the pool, in USD. */
  share: number;
  /** Each settled tier: what it funded (titles), and what this badge paid of that. */
  settled: { tier: Tier; funded: string[]; paid: { title: string; usd: number }[] }[];
  /** The tiers not settled yet, in order. */
  open: Tier[];
}) {
  const spent = settled.reduce((a, t) => a + t.paid.reduce((p, x) => p + x.usd, 0), 0);
  const left = Math.max(0, share - spent);
  const pct = share > 0 ? Math.min(100, (spent / share) * 100) : 0;
  return (
    <section
      aria-label="Your share"
      className="rounded-xl border border-vote/30 bg-vote/[.06] p-4 text-left"
    >
      <p className="flex items-baseline justify-between gap-3">
        <b className="font-inter-tight text-[15px] font-semibold text-white">
          Your share: {dollars(share)}
        </b>
        <span className="text-[13px] text-white/60 tnum">{dollars(spent)} spent</span>
      </p>
      <div
        role="meter"
        aria-label="Your share spent"
        aria-valuemin={0}
        aria-valuemax={Math.round(share)}
        aria-valuenow={Math.round(spent)}
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/10"
      >
        <i className="block h-full rounded-full bg-vote" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 space-y-1.5 text-[13.5px] text-white/75">
        {settled.map((t) => {
          const sum = t.paid.reduce((a, x) => a + x.usd, 0);
          const what = `${t.tier} settled, funding ${t.funded.length ? and(t.funded) : "nothing"}.`;
          return (
            <li key={t.tier}>
              {t.paid.length === 0
                ? <>{t.funded.length ? `${what} None of your share went to it.` : what}</>
                : (
                  <>
                    {what} <span className="text-white">You paid {dollars(sum)}</span>{" "}
                    <span className="text-white/60">
                      ({t.paid.map((x) => `${x.title} ${dollars(x.usd)}`).join(" · ")})
                    </span>
                  </>
                )}
            </li>
          );
        })}
      </ul>
      {open.length > 0 && (
        <p className="mt-2 text-[13.5px] font-medium text-white">
          {dollars(left)} left for {and(open)}. It goes where you rank them.
        </p>
      )}
    </section>
  );
}
