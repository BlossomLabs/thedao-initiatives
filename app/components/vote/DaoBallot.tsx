import FinalTiers, { AvatarRing, CardHeader, dollars } from "~/components/vote/FinalTiers";
import { poolSegments, SegmentRing } from "~/components/vote/BallotMeter";
import type { BallotItem } from "~/components/vote/TierBallot";
import type { Tier } from "../../../shared/vote/ballot";

export type SettledTier = { tier: Tier; funded: string[]; awards: Record<string, number> };
/** What the open tiers would fund if they settled now: tier and USD by initiative. */
export type LiveTally = {
  tiers: Partial<Record<string, Tier>>;
  awards: Record<string, number>;
};

/** TheDAO's ballot: the settled tiers and the live tally as one tier table. `funded` is
 * every initiative it funds, `provisional` what only the live tally funds (green, where
 * what a settled tier funded is gold). */
export function daoResult(settled: SettledTier[] | undefined, tally: LiveTally | undefined) {
  const awards = new Map<string, number>([
    ...(settled?.flatMap((t) => Object.entries(t.awards)) ?? []),
    ...Object.entries(tally?.awards ?? {}),
  ]);
  const funded = new Set([
    ...(settled?.flatMap((t) => t.funded) ?? []),
    ...Object.keys(tally?.awards ?? {}),
  ]);
  const tiers: Partial<Record<string, Tier>> = {
    ...Object.fromEntries(Object.entries(tally?.tiers ?? {})),
    ...Object.fromEntries(settled?.flatMap((t) => t.funded.map((slug) => [slug, t.tier])) ?? []),
  };
  const settledFunded = new Set(settled?.flatMap((t) => t.funded) ?? []);
  const provisional = new Set(
    Object.keys(tally?.awards ?? {}).filter((slug) => !settledFunded.has(slug)),
  );
  return { awards, funded, tiers, provisional };
}

/**
 * TheDAO's ballot as a card's header and tier table (two children, so a card laid out as a
 * subgrid lines them up with the card beside it): TheDAO's logo in a ring of what it
 * allocated of the pool, then the tiers with what each funds.
 *
 * During the vote (`live`) the ring is gold for the settled tiers and neutral for what the
 * live tally would add, green for the part of it going to the initiatives on `mine`. On the vote results a donation can be previewed: `joining` and
 * `leaving` as FinalTiers draws them, and the amounts (`awards`) as they would be with it.
 */
export default function DaoBallot(
  {
    items,
    result,
    poolUsd,
    live,
    label,
    action,
    note,
    table,
    liveTone = "green",
    mine,
  }: {
    items: BallotItem[];
    result: ReturnType<typeof daoResult>;
    poolUsd?: number;
    live?: boolean;
    /** Its title, and the table's name for screen readers. */
    label: string;
    /** At the end of the header. */
    action?: React.ReactNode;
    /** A line between the header and the table (a donation's preview). */
    note?: React.ReactNode;
    /** More for the table: the chips' links to another table, the gold ones, a preview. */
    table?: Partial<React.ComponentProps<typeof FinalTiers>>;
    /** The live tally's chips: green (a ballot's page) or neutral (the vote results). */
    liveTone?: "green" | "neutral";
    /** On a ballot's page: the initiatives on that ballot. What the live tally would give
     * them is green on the ring; the rest of it stays neutral. */
    mine?: ReadonlySet<string>;
  },
) {
  const { awards, funded, tiers, provisional } = result;
  const leaving = table?.leaving;
  const joining = table?.joining;
  const counted = [...awards].filter(([slug]) => !leaving?.has(slug));
  const sum = (which: (slug: string) => boolean) =>
    counted.reduce((a, [slug, v]) => a + (which(slug) ? v : 0), 0);
  const awarded = sum(() => true);
  const count = [...funded].filter((slug) => !leaving?.has(slug)).length;
  const logo = (
    <img src="/dao-logo.svg" alt="TheDAO" width={48} height={48} className="scale-[1.15]" />
  );
  return (
    <>
      <div>
        <CardHeader
          avatar={live && poolUsd
            ? (
              // Gold what the settled tiers awarded, green what the live tally would add,
              // as the chips below; each with its popup.
              <SegmentRing
                segments={poolSegments({
                  settledUsd: sum((slug) => !provisional.has(slug)),
                  mineUsd: sum((slug) =>
                    provisional.has(slug) && !joining?.has(slug) && Boolean(mine?.has(slug))
                  ),
                  liveUsd: sum((slug) =>
                    provisional.has(slug) && !joining?.has(slug) && !mine?.has(slug)
                  ),
                  // What comes in with a previewed donation: a solid green stretch.
                  previewUsd: sum((slug) => Boolean(joining?.has(slug))),
                  pool: poolUsd,
                  // TheDAO's own ring: what the live tally adds is neutral, except (green,
                  // on a ballot's page) what goes to initiatives on that ballot.
                  liveTone: "neutral",
                })}
                label="What TheDAO allocated of the pool"
                max={poolUsd}
                now={Math.min(awarded, poolUsd)}
                valueText={`${dollars(awarded)} of ${dollars(poolUsd)}.`}
              >
                {logo}
              </SegmentRing>
            )
            : (
              <AvatarRing
                frac={poolUsd ? awarded / poolUsd : 0}
                label="What TheDAO allocated of the pool"
              >
                {logo}
              </AvatarRing>
            )}
          title={label}
          line={`${dollars(awarded)}${poolUsd ? ` of the ${dollars(poolUsd)} pool` : ""}${
            live ? " if it ended now" : ""
          } · ${count} ${count === 1 ? "initiative" : "initiatives"}`}
          action={action}
        />
        {note}
      </div>
      <FinalTiers
        label={label}
        items={items}
        tiers={tiers}
        funded={funded}
        amounts={awards}
        amountWord="awarded"
        provisional={provisional}
        mirrored
        liveTone={liveTone}
        {...table}
      />
    </>
  );
}
