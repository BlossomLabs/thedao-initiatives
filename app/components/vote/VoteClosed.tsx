import { useEffect, useMemo, useRef, useState } from "react";
import BallotArrows, { type ArrowFrom } from "~/components/vote/BallotArrows";
import { bytesToHex, hexToBytes } from "viem";
import { Button, LinkButton, SMALL_BUTTON } from "~/components/ui/Button";
import { Link } from "react-router";
import { cn } from "~/lib/utils";
import FinalTiers, { AvatarRing, CardHeader, dollars } from "~/components/vote/FinalTiers";
import type { BallotItem } from "~/components/vote/TierBallot";
import { useVoteBallots } from "~/hooks/use-vote";
import { errorMessage } from "~/lib/api";
import { decodeBallot, encodeBallot, type Tier } from "../../../shared/vote/ballot";
import { ROUND, type VoteManifest } from "../../../shared/vote/manifest";

function Header(
  { kicker, title = "Voting has closed", children }: {
    kicker: string;
    title?: string;
    children?: React.ReactNode;
  },
) {
  return (
    <header className="pt-4 text-center">
      <p className="kicker m-0">{kicker}</p>
      <h1 className="mt-3 font-inter-tight text-[clamp(28px,5vw,40px)] font-bold leading-[1.1] tracking-[-.03em] text-white">
        {title}
      </h1>
      {children && (
        <p className="mx-auto mt-3 max-w-[540px] font-inter-tight text-[16px] leading-snug text-white/70">
          {children}
        </p>
      )}
    </header>
  );
}

/** "TheDAO vote · Badge #12" or "Test vote · Badge #12". */
export const badgeKicker = (n: number, round: VoteManifest = ROUND) =>
  `${round.kind === "real" ? "TheDAO vote" : "Test vote"} · Badge #${n}`;

const NOTHING: Partial<Record<string, Tier>> = {};

const SeeResult = () => (
  <div className="flex justify-center">
    <LinkButton variant="primary" to="/vote">See the result</LinkButton>
  </div>
);

/** After the close, in place of the welcome page and the ballot: says the vote is
 * over and, for the badge's owner, shows the ballot they sent (read from the chain,
 * so it shows on any device). `n` is null for a code nobody claimed.
 *
 * During the vote (`live`), the same page is where a sent ballot lands: the ballot that
 * counts, next to what the settled tiers funded so far, with a way back to editing. */
export default function VoteClosed(
  {
    n,
    titles,
    closeText,
    saved = NOTHING,
    settled,
    round = ROUND,
    sent: sentHere,
    items,
    paid,
    shareUsd,
    poolUsd,
    avatar,
    live,
    roundBox,
  }: {
    n: number | null;
    /** The round (a dev mock's fictional one, or the real one). */
    round?: VoteManifest;
    /** The ballot the badge sent, when known without the chain (a dev mock). */
    sent?: Partial<Record<string, Tier>>;
    /** What each tier settled on (the quiet ending), with each award in USD, when known. */
    settled?: { tier: Tier; funded: string[]; awards: Record<string, number> }[];
    /** The pool, USD (the result's total is said against it). */
    poolUsd?: number;
    /** This badge's avatar (the account's, or the badge's own), for its card's header. */
    avatar?: React.ReactNode;
    /** This browser's tiers for the badge: shown when they are what was sent, since
     * the chain's ranks can't tell an empty A from an empty S. */
    saved?: Partial<Record<string, Tier>>;
    titles: ReadonlyMap<string, string>;
    closeText: React.ReactNode;
    /** The round's initiatives with their cards (categories), for the tier table. */
    items?: BallotItem[];
    /** USD this badge paid for each initiative it helped fund. */
    paid?: ReadonlyMap<string, number>;
    /** This badge's equal share of the pool, USD. */
    shareUsd?: number;
    /** During the vote: the ballot that counts (`sent`), the way back to editing it,
     * where the round is, and the live tally: what the open tiers would fund if they
     * settled now (tier and USD by initiative), shown with the settled ones as the live
     * result. */
    /** Where the round is, over the two cards: during the vote and after it. */
    roundBox?: React.ReactNode;
    live?: {
      onEdit: () => void;
      tally?: { tiers: Partial<Record<string, Tier>>; awards: Record<string, number> };
    };
  },
) {
  // The chain's ballots only when this page doesn't know the sent one already.
  const ballots = useVoteBallots(false, !sentHere);
  const sent = useMemo(() => {
    if (sentHere) return sentHere;
    if (n === null || !ballots.data) return undefined;
    const b = ballots.data.ballots.find((x) => x.tokenId === String(n));
    if (!b) return null;
    const same = bytesToHex(encodeBallot(round.slugs, saved)).toLowerCase() ===
      b.ballot.toLowerCase();
    return same ? saved : decodeBallot(hexToBytes(b.ballot), round.slugs);
  }, [ballots.data, n, saved, sentHere, round]);

  // What the vote funds: the settled tiers, and during the vote what the open ones would
  // if they settled now (the live tally).
  const tally = live?.tally;
  /** The result table's name, for its card, its table and the arrows between them. */
  const resultLabel = live ? "The live result" : "TheDAO's result";
  const funded = new Set([
    ...(settled?.flatMap((t) => t.funded) ?? []),
    ...Object.keys(tally?.awards ?? {}),
  ]);
  // An arrow between a winner on this ballot and the same initiative in the result, while
  // either chip is hovered or focused, or after a tap (until a tap elsewhere). It points
  // away from the chip picked: ballot → result, or result → ballot.
  const tables = useRef<HTMLDivElement>(null);
  const crossing = new Set(sent ? Object.keys(sent).filter((slug) => funded.has(slug)) : []);
  type Pick = { slug: string; from: ArrowFrom };
  const [hovered, setHovered] = useState<Pick>();
  const [pinned, setPinned] = useState<Pick>();
  const active = hovered ?? pinned;
  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.("[data-final-chip]")) setPinned(undefined);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);
  const link = (from: ArrowFrom) => ({
    linked: crossing,
    active: active?.slug,
    onHover: (slug: string | undefined) => setHovered(slug ? { slug, from } : undefined),
    onTap: (slug: string) =>
      setPinned((p) => (p?.slug === slug && p.from === from ? undefined : { slug, from })),
  });

  if (n === null) {
    return (
      <div className="space-y-6">
        <Header kicker={round.kind === "real" ? "TheDAO vote" : "Test vote · Demo on Sepolia"}>
          The vote ended {closeText}. Thanks for stopping by!
        </Header>
        <SeeResult />
      </div>
    );
  }

  const all = items ?? round.slugs.map((slug) => ({ slug, title: titles.get(slug) ?? slug }));
  // The vote's result as the same table: each tier with what it funded and each award.
  // During the vote, the live result: the settled tiers and the live tally together.
  const awards = new Map([
    ...(settled?.flatMap((t) => Object.entries(t.awards)) ?? []),
    ...Object.entries(tally?.awards ?? {}),
  ]);
  const awarded = [...awards.values()].reduce((a, b) => a + b, 0);
  const resultTiers: Partial<Record<string, Tier>> = {
    ...Object.fromEntries(Object.entries(tally?.tiers ?? {})),
    ...Object.fromEntries(settled?.flatMap((t) => t.funded.map((slug) => [slug, t.tier])) ?? []),
  };
  const result = Object.keys(resultTiers).length > 0 && (
    <FinalTiers
      label={resultLabel}
      items={all}
      tiers={resultTiers}
      funded={funded}
      amounts={awards}
      amountWord={live ? "if it ended now" : "awarded"}
      mirrored
      {...link("result")}
      // Gold only for what this badge also ranked.
      highlight={new Set(Object.keys(sent ?? {}))}
    />
  );

  // Each card's header: an avatar in a ring of what went to what was funded.
  const allocated = [...(paid ?? new Map<string, number>()).values()].reduce((a, b) => a + b, 0);
  const sentSomething = Boolean(sent && Object.keys(sent).length);
  const mineHeader = (
    <CardHeader
      avatar={
        <AvatarRing
          frac={shareUsd ? allocated / shareUsd : 0}
          label="What your badge allocated of its share"
        >
          {avatar}
        </AvatarRing>
      }
      title="Your ballot"
      line={!sentSomething
        ? "No ballot from this badge"
        : allocated > 0
        ? `${dollars(allocated)}${shareUsd ? ` of your ${dollars(shareUsd)} share` : " allocated"}`
        : live
        ? `Counts · ${Object.keys(sent ?? {}).length} initiatives placed`
        : "Nothing on it was funded"}
      action={live && (
        // During the vote the ballot is the one to change: its own button.
        <Button sm variant="primary" className="flex-none" onClick={live.onEdit}>
          Edit my ballot
        </Button>
      )}
    />
  );
  const resultHeader = (
    <CardHeader
      avatar={
        <AvatarRing
          frac={poolUsd ? awarded / poolUsd : 0}
          label="What TheDAO allocated of the pool"
        >
          <img src="/dao-logo.svg" alt="TheDAO" width={48} height={48} className="scale-[1.15]" />
        </AvatarRing>
      }
      title={resultLabel}
      line={`${dollars(awarded)}${poolUsd ? ` of the ${dollars(poolUsd)} pool` : ""}${
        live ? " if it ended now" : ""
      } · ${funded.size} ${funded.size === 1 ? "initiative" : "initiatives"}`}
      action={
        // The tables are the result already; the board shows each initiative with its
        // funding bar and its page.


          <Link
            to="/vote"
            className={cn(SMALL_BUTTON, "flex-none no-underline hover:no-underline")}
          >
            See them on the board →
          </Link>

      }
    />
  );

  let ballot: React.ReactNode;
  if (ballots.isPending && !sentHere) {
    ballot = <p className="text-white/60">Loading your ballot…</p>;
  } else if (ballots.isError && !sentHere) {
    ballot = (
      <>
        <p>We couldn't load your ballot right now. {errorMessage(ballots.error)}</p>
        <Button className="mt-4" onClick={() => ballots.refetch()}>Try again</Button>
      </>
    );
  } else if (!sent || Object.keys(sent).length === 0) {
    ballot = <p>This badge didn't send a ballot before voting closed.</p>;
  } else {
    // The settled tier table: what this badge put where, and what it paid for each.
    const amounts = paid ?? new Map<string, number>();
    ballot = (
      <FinalTiers
        label="Your ballot"
        items={all}
        tiers={sent}
        funded={funded}
        amounts={amounts}
        amountWord="your share paid"
        {...link("ballot")}
      />
    );
  }

  return (
    <div className="space-y-6">
      {live
        ? (
          <>
            <Header kicker={badgeKicker(n, round)} title="Your ballot">
              It counts. You can change it until each tier settles
              {result
                ? "; next to it, the live result: what the vote would fund if it ended now."
                : "."}
            </Header>
          </>
        )
        : (
          // The same page as during the vote, its last state: the vote is over.
          <Header kicker={`${badgeKicker(n, round)} · Voting has closed`} title="Your ballot">
            The vote ended {closeText}. Here is your ballot next to TheDAO's result.
          </Header>
        )}
      {
        // As wide as the cards below: both columns, or the ballot alone.
        roundBox && <div className={cn(!result && "mx-auto max-w-[640px]")}>{roundBox}</div>
      }
      {
        /* One grid for both cards: each card spans four rows (header, Tier-S, Tier-A,
          Tier-B) as a subgrid, so each row is as tall as the taller of the two. */
      }
      <div
        ref={tables}
        className={cn(
          "relative grid grid-cols-1 gap-x-6 gap-y-6",
          // Alone (nothing settled yet), the ballot sits in the middle.
          result ? "sm:grid-cols-2" : "mx-auto max-w-[640px]",
        )}
      >
        <div className="card row-span-4 grid min-w-0 grid-cols-1 grid-rows-subgrid gap-y-2 text-[15px] leading-relaxed text-white/80">
          {mineHeader}
          {ballot}
        </div>
        {result && (
          <div className="card row-span-4 grid min-w-0 grid-cols-1 grid-rows-subgrid gap-y-2 text-[15px] leading-relaxed text-white/80">
            {resultHeader}
            {result}
          </div>
        )}
        {result && (
          <BallotArrows
            root={tables}
            slug={active?.slug}
            from={active?.from}
            resultLabel={resultLabel}
          />
        )}
      </div>
      {
        // Without the result table, the button is the way to it (after the close).
        !result && !live && <SeeResult />
      }
    </div>
  );
}
