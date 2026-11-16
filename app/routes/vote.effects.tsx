import { useState } from "react";
import { Link } from "react-router";
import PageMain from "~/components/layout/PageMain";
import { Button } from "~/components/ui/Button";
import Hero from "~/components/board/Hero";
import { confettiBurst } from "~/components/donate/Celebration";
import { poolSegments, SegmentRing } from "~/components/vote/BallotMeter";
import FinalTiers from "~/components/vote/FinalTiers";
import { RowFigure } from "~/components/vote/GiveList";
import TierBallot from "~/components/vote/TierBallot";
import BallotStatus from "~/components/vote/BallotStatus";
import { glowBadge } from "~/lib/badge-glow";
import { Countdown, voteNow } from "~/components/vote/When";
import { cn } from "~/lib/utils";
import { type Tier, tierName } from "../../shared/vote/ballot";

export function meta() {
  return [{ title: "Vote animations · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** Made-up initiatives: the effects need titles, nothing else. */
const ITEMS = [
  "Fuzzing the clients",
  "Audit fund",
  "Bug bounty triage",
  "Formal specs",
  "Incident drills",
  "Key ceremonies",
].map((title, i) => ({ slug: `x${i}`, title }));
const [A, B, C, D, E] = ITEMS.map((i) => i.slug);

/** The live tally before and after: one moves up, one moves down, one comes in. */
const BEFORE: Partial<Record<string, Tier>> = { [A]: "S", [B]: "A", [C]: "A", [D]: "B" };
const AFTER: Partial<Record<string, Tier>> = { [A]: "S", [B]: "S", [C]: "B", [D]: "B", [E]: "A" };

/**
 * /vote/effects: every animation of the vote on one page, each with a button that plays
 * it, on the real components with made-up initiatives. Nothing is sent or donated.
 */
export default function VoteEffects() {
  return (
    <PageMain className="pt-8">
      <header className="mb-6 space-y-2">
        <p className="m-0 text-[12px] uppercase tracking-[.08em] text-vote">Example</p>
        <h1 className="m-0 font-inter-tight text-[28px] font-bold tracking-[-.02em] text-white">
          The vote's animations
        </h1>
        <p className="m-0 max-w-[640px] text-[14.5px] leading-relaxed text-white/65">
          Each one plays here on its own, on made-up initiatives. On the real pages they play when
          it happens while the page is open. With reduced motion on, the colours and glows stay; the
          pops, flips and counting don't. The{" "}
          <Link to="/vote/results/s-settling" className="text-dao-green">example results</Link>{" "}
          show them in place.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonationEffect />
        <BallotCountedEffect />
        <TierSettlesEffect />
        <LiveMovesEffect />
        <GapEffect />
        <RingEffect />
        <CountdownEffect />
        <FinishEffect />
      </div>
    </PageMain>
  );
}

function Effect(
  { title, where, children, onPlay, playLabel = "Play", wide }: {
    title: string;
    /** Where and when it plays on the real pages. */
    where: string;
    children?: React.ReactNode;
    onPlay: () => void;
    playLabel?: string;
    wide?: boolean;
  },
) {
  return (
    <section
      aria-label={title}
      className={cn(
        "card flex min-w-0 flex-col gap-4 text-[14px] text-white/80",
        wide && "lg:col-span-2",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="m-0 font-inter-tight text-[18px] font-semibold text-white">{title}</h2>
          <p className="m-0 text-[13px] leading-snug text-white/55">{where}</p>
        </div>
        <Button sm className="flex-none" onClick={onPlay}>{playLabel}</Button>
      </div>
      {children}
    </section>
  );
}

/** Two renders apart: `reset` now, `then` on the next frame, so a change is seen as one. */
function replay(reset: () => void, then: () => void) {
  reset();
  setTimeout(then, 60);
}

function DonationEffect() {
  return (
    <Effect
      title="Donation confirmed"
      where="The donate box (front page, initiative page, vote results) and the test-dollar form, once the donation is confirmed."
      onPlay={() => confettiBurst()}
    />
  );
}

function BallotCountedEffect() {
  const [plays, setPlays] = useState(0);
  return (
    <Effect
      title="Ballot counted"
      where="The ballot editor, when a send you watched ends counted: the Counted stamp under the ballot presses down, and the badge mark on your avatar in the top bar glows (signed in with a badge). The ballot itself stays still."
      onPlay={() => {
        glowBadge();
        setPlays((n) => n + 1);
      }}
      wide
    >
      <TierBallot
        items={ITEMS}
        tiers={{ [A]: "S", [B]: "S", [D]: "B", [E]: "B" }}
        disabled
        onChange={() => {}}
        // Under the ballot, in the box the editor gives it (VotePage). Before the first
        // play, a ballot that already counts: the stamp without the press.
        actions={
          <div className="space-y-3 sm:rounded-2xl sm:border sm:border-white/10 sm:bg-white/[.03] sm:p-4">
            <BallotStatus
              key={plays}
              phase={plays > 0 ? { kind: "counted", hash: "0x" } : { kind: "idle" }}
              route="relay"
              upToDate
              canSend={false}
              sendLabel="Send my ballot"
              resultsHref="/vote/effects"
              onSend={() => {}}
              onSelfSend={() => {}}
              onRetry={() => {}}
            />
          </div>
        }
      />
    </Effect>
  );
}

function TierSettlesEffect() {
  const [settled, setSettled] = useState(false);
  const all = new Set([A, B, C, D]);
  return (
    <Effect
      title="A tier settles"
      where="TheDAO's ballot on the vote results: what the settled tier funds turns gold, glowing, one after another; the row flashes gold."
      onPlay={() => replay(() => setSettled(false), () => setSettled(true))}
    >
      <div className="grid grid-cols-1 gap-y-2">
        <FinalTiers
          label="TheDAO's ballot"
          items={ITEMS}
          tiers={{ [A]: "S", [B]: "S", [C]: "S", [D]: "A" }}
          funded={all}
          amounts={new Map([[A, 120_000], [B, 80_000], [C, 45_000], [D, 30_000]])}
          amountWord="awarded"
          provisional={settled ? new Set([D]) : all}
          liveTone="neutral"
          celebrate
        />
      </div>
    </Effect>
  );
}

function LiveMovesEffect() {
  const [after, setAfter] = useState(false);
  const tiers = after ? AFTER : BEFORE;
  const shown = Object.keys(tiers);
  return (
    <Effect
      title="Live tally moves"
      where="TheDAO's ballot on the vote results, at each refresh: what changes tier moves there, the others slide aside, and a new one pops in."
      playLabel={after ? "Play back" : "Play"}
      onPlay={() => setAfter((x) => !x)}
    >
      <div className="grid grid-cols-1 gap-y-2">
        <FinalTiers
          label="TheDAO's ballot"
          items={ITEMS}
          tiers={tiers}
          funded={new Set(shown)}
          amounts={new Map(shown.map((s, i) => [s, 20_000 + i * 15_000]))}
          amountWord="awarded"
          provisional={new Set(shown)}
          liveTone="neutral"
          moves
        />
      </div>
    </Effect>
  );
}

function GapEffect() {
  const [state, setState] = useState<"gap" | "smaller" | "threat">("gap");
  const row = (title: string, figure: React.ReactNode) => (
    <div className="flex min-h-14 items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.04] px-3.5 py-2.5">
      <span className="size-2 flex-none rounded-full bg-white/30" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[14px] text-white">{title}</span>
      {figure}
    </div>
  );
  return (
    <Effect
      title="A gap closes"
      where="What it takes to move up, on the vote results: a gap counts to its new amount; one a donation closes counts down to $0 and flips green."
      playLabel={state === "gap" ? "Close the gap" : "Reset"}
      onPlay={() => setState((s) => (s === "gap" ? "threat" : "gap"))}
    >
      <div className="flex flex-col gap-1.5">
        {row(
          "Audit fund",
          <RowFigure
            kind={state === "threat" ? "threat" : "gap"}
            usd={state === "threat" ? 4_000 : state === "smaller" ? 3_000 : 9_000}
            to="A-Tier"
            name="A-Tier"
          />,
        )}
      </div>
      <div className="flex gap-2">
        <Button sm onClick={() => setState("smaller")} disabled={state !== "gap"}>
          A donation shrinks it
        </Button>
      </div>
    </Effect>
  );
}

function RingEffect() {
  const POOL = 1_000_000;
  const [step, setStep] = useState(0);
  // Before S-Tier settles; S-Tier settled ($420k gold); later, A-Tier too.
  const states = [
    { settledUsd: 0, nextUsd: 420_000, liveUsd: 260_000 },
    { settledUsd: 420_000, nextUsd: 230_000, liveUsd: 110_000 },
    { settledUsd: 650_000, nextUsd: 140_000, liveUsd: 0 },
  ];
  const s = states[step];
  const segments = poolSegments({ ...s, pool: POOL, liveTone: "neutral" });
  const awarded = s.settledUsd + s.nextUsd + s.liveUsd;
  return (
    <Effect
      title="TheDAO's ring"
      where="TheDAO's ballot on the vote results: segments grow and shrink with each tally; a new one (the gold of a settled tier) grows in from its start."
      playLabel={step === states.length - 1 ? "Reset" : "Next tally"}
      onPlay={() => setStep((x) => (x + 1) % states.length)}
    >
      <div className="flex items-center gap-4">
        <SegmentRing
          segments={segments}
          label="What TheDAO allocated of the pool"
          max={POOL}
          now={awarded}
          valueText={`$${awarded.toLocaleString("en-US")} of $1,000,000.`}
        >
          <img src="/dao-logo.svg" alt="TheDAO" width={48} height={48} className="scale-[1.15]" />
        </SegmentRing>
        <p className="m-0 text-[13.5px] text-white/65">
          {["Voting is open", "S-Tier settled", "A-Tier settled"][step]}
        </p>
      </div>
    </Effect>
  );
}

function CountdownEffect() {
  const at = () => Math.floor(voteNow() / 1000);
  const [calm] = useState(() => at() + 2 * 3600 + 14 * 60);
  const [to, setTo] = useState(() => at() + 5 * 60 + 6);
  const pill =
    "flex-none rounded-full border border-white/20 px-2.5 py-0.5 text-[12px] text-white/80 tnum";
  return (
    <Effect
      title="Countdown's last minutes"
      where="The round box: in the last five minutes before the next step, the countdown breathes gold."
      playLabel="From 5:06"
      onPlay={() => setTo(at() + 5 * 60 + 6)}
    >
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-white/60">
        <span className="flex items-center gap-2">
          Far off <Countdown to={calm} className={pill} />
        </span>
        <span className="flex items-center gap-2">
          About to settle{" "}
          <Countdown
            to={to}
            className={pill}
            soonClassName="text-vote-pale motion-safe:animate-countdown-soon"
          />
        </span>
      </div>
    </Effect>
  );
}

function FinishEffect() {
  const [n, setN] = useState(0);
  // The final result's funded cards, by tier: they glow tier by tier, S-Tier first.
  const tiers: [Tier, string[]][] = [
    ["S", ["Fuzzing the clients", "Audit fund"]],
    ["A", ["Bug bounty triage", "Formal specs"]],
    ["B", ["Incident drills"]],
  ];
  return (
    <Effect
      title="The vote finishes"
      where="The vote results, when the last tier settles while the page is open: the hero glows gold, a gold light runs across the amount and fills the line under it, and the funded cards glow tier by tier."
      onPlay={() => setN((x) => x + 1)}
      wide
    >
      <div key={n}>
        <div className={cn(n > 0 && "animate-gold-halo")}>
          <Hero
            raised={815_000}
            finished={n > 0}
            kicker={<span className="text-vote">Test vote</span>}
            sub={
              <>
                $815k of $1M <span className="text-vote">demo pool</span> spent
              </>
            }
          />
        </div>
        <div className="mt-6 space-y-4">
          {tiers.map(([t, titles], ti) => (
            <div key={t} className="space-y-2">
              <h3 className="m-0 font-inter-tight text-[16px] font-semibold text-white">
                {tierName(t)}
              </h3>
              <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
                {titles.map((title, i) => (
                  <div
                    key={title}
                    style={n > 0 ? { animationDelay: `${ti * 900 + i * 120}ms` } : undefined}
                    className={cn(
                      "rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white",
                      n > 0 && "animate-gold-glow",
                    )}
                  >
                    {title}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Effect>
  );
}
