import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { cn } from "~/lib/utils";
import { type Tier, tierName } from "../../../shared/vote/ballot";

/** Whole dollars: a badge's share is thousands, the cents say nothing here. */
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const RING = 64;
const STROKE = 4;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;
/** How far past the ring its hover area reaches: the 4px arc alone is too thin to aim
 * at, so the whole disc and a margin round it pick a segment by the pointer's angle. */
const HIT_MARGIN = 8;
/** The ring's dashed end: how long (px along the ring), and dash, gap (px). A ballot that
 * reaches it reads as one that can keep growing past the full ring. */
const TAIL = 24;
const DASH = "2 2";
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** One segment of the ring: from `from` to `to`, as fractions of the way round from the
 * top (clamped to the ring). Segments lie end to end, so each shows its own colour on the track,
 * never mixed with another. */
function Arc(
  { from = 0, to, className, dim }: {
    from?: number;
    to: number;
    className: string;
    /** Another segment's popup is open: this one fades back (data-viz systems' hover). */
    dim?: boolean;
  },
) {
  const a = clamp(from);
  const b = Math.max(a, clamp(to));
  return (
    <circle
      cx={RING / 2}
      cy={RING / 2}
      r={R}
      fill="none"
      strokeWidth={STROKE}
      strokeDasharray={`${C * (b - a)} ${C}`}
      strokeDashoffset={-C * a}
      data-from={a}
      data-to={b}
      data-dim={dim || undefined}
      opacity={dim ? 0.3 : 1}
      className={`${className} [transition:stroke-dasharray_.5s,stroke-dashoffset_.5s,opacity_.15s_ease-out] motion-reduce:[transition:none]`}
    />
  );
}

/** A dashed stretch of the ring, from `from` to `to` (fractions from the top): the ring's
 * last stretch, so a full one reads as a line you can keep extending. Drawn as an arc path, since
 * the dashes need their own dash pattern (a circle's is taken by a segment's extent). */
function Dashes({ from, to, className, dim }: {
  from: number;
  to: number;
  className: string;
  dim?: boolean;
}) {
  const c = RING / 2;
  const at = (t: number) =>
    `${(c + R * Math.cos(2 * Math.PI * t)).toFixed(3)} ${
      (c + R * Math.sin(2 * Math.PI * t)).toFixed(3)
    }`;
  return (
    <path
      d={`M ${at(from)} A ${R} ${R} 0 ${to - from > 0.5 ? 1 : 0} 1 ${at(to)}`}
      fill="none"
      strokeWidth={STROKE}
      strokeDasharray={DASH}
      opacity={dim ? 0.3 : 1}
      data-dashes=""
      className={`${className} [transition:opacity_.15s_ease-out] motion-reduce:[transition:none]`}
    />
  );
}

/** On the ballot: the voter's avatar ringed by what the ballot asks for, full at `target`
 * (3× the pool: the 1.5× the ballot rules want is half way round), in three parts from the top: gold for what the
 * settled tiers funded, pale gold for what they hold but didn't fund (locked, still first
 * in line for what is left), green for the open tiers, the part still yours to change.
 * Beside it, the ask, this badge's share and what each settled tier took. */
export default function BallotMeter(
  { avatar, asked, target, pool, share, shareFinal, settled, menu, status, compact }: {
    /** The voter's avatar, drawn inside the ring. */
    avatar: React.ReactNode;
    /** What the ballot's placed initiatives ask for in all, in USD. */
    asked: number;
    /** Where the ring is full, in USD: 3× the pool, twice what a ballot must ask for. */
    target: number;
    /** The pool, in USD (for the tooltip). */
    pool: number;
    /** This badge's equal share of the pool, in USD, if known. */
    share?: number;
    /** False while registration is open: the share is an estimate. */
    shareFinal: boolean;
    /** Each settled tier: how many of this ballot's initiatives it funded, for how much
     * (USD), and what this badge paid (USD); for the ring, what this ballot's initiatives
     * in it ask for (USD), funded or not. */
    settled: {
      tier: Tier;
      funded: number;
      fundedUsd: number;
      paid: number;
      fundedAsk: number;
      waitingAsk: number;
    }[];
    /** Beside the "Your ballot" label: the LLM guide button and its menu (copy, paste). */
    menu?: React.ReactNode;
    /** In a round with ballot rules, in place of the share: the first rule still to meet,
     * or that the ballot is valid and can take more. */
    status?: { ok: boolean; text: string };
    /** On a phone, pinned over the editor: no box of its own, tighter lines. */
    compact?: boolean;
  },
) {
  const spent = settled.reduce((a, t) => a + t.paid, 0);
  const fundedAsk = settled.reduce((a, t) => a + t.fundedAsk, 0);
  const waitingAsk = settled.reduce((a, t) => a + t.waitingAsk, 0);
  const segments = ballotSegments({
    asked,
    target,
    pool,
    fundedAsk,
    waitingAsk,
    anySettled: settled.length > 0,
  });
  return (
    <section
      aria-label="Your ballot"
      className={cn(
        "relative flex items-center",
        compact ? "gap-3" : "gap-4 rounded-xl border border-vote/30 bg-vote/[.06] p-4",
      )}
    >
      <SegmentRing
        segments={segments}
        label="What your ballot asks for"
        max={target}
        now={Math.min(asked, target)}
        valueText={`${dollars(asked)} of ${dollars(target)}.`}
        dashedEnd
      >
        {avatar}
      </SegmentRing>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] uppercase tracking-[.08em] text-white/55">Your ballot</p>
          {menu}
        </div>
        <p className="font-inter-tight text-[16px] font-semibold text-white tnum">
          {dollars(asked)} asked
        </p>
        {settled.map((t) => (
          <p key={t.tier} className="text-[13px] text-white/65 tnum">
            {t.funded > 0
              ? `${tierName(t.tier)} funded ${t.funded} · ${dollars(t.fundedUsd)}`
              : `${tierName(t.tier)} funded nothing from your ballot`}
          </p>
        ))}
        {status
          ? (
            <p
              role="status"
              data-ballot-reason=""
              className={cn("text-[13px]", status.ok ? "text-dao-green" : "text-amber-200")}
            >
              {status.text}
            </p>
          )
          : share !== undefined && (
            <p className="text-[13px] text-white/65 tnum">
              {settled.length
                ? `${dollars(Math.max(0, share - spent))} of your ${dollars(share)} share left`
                : `Your share: ${shareFinal ? "" : "about "}${dollars(share)}`}
            </p>
          )}
      </div>
    </section>
  );
}

/** One part of a ring: where it lies (fractions of the way round from the top), its
 * colour (none for what's left empty) and its popup. */
export type Segment = {
  key: string;
  from: number;
  to: number;
  className: string;
  swatch: string;
  title: string;
  amount: number;
  text: string;
};
const fit = (xs: Segment[]) =>
  xs.map((x) => ({ ...x, from: clamp(x.from), to: clamp(x.to) })).filter((x) => x.to > x.from);

/** A ballot's ring, end to end from the top: gold what the settled tiers funded, pale gold
 * what they hold unfunded, green the open tiers, then what's left to fill (full at
 * `target`, 3× the pool). The editor's ring, and the "your ballot" page's. */
export function ballotSegments(
  { asked, target, pool, fundedAsk, waitingAsk, anySettled }: {
    asked: number;
    target: number;
    pool: number;
    fundedAsk: number;
    waitingAsk: number;
    anySettled: boolean;
  },
): Segment[] {
  const open = Math.max(0, asked - fundedAsk - waitingAsk);
  const f = (usd: number) => (target > 0 ? usd / target : 0);
  return fit([
    {
      key: "funded",
      from: 0,
      to: f(fundedAsk),
      className: "stroke-vote",
      swatch: "bg-vote",
      title: "Funded",
      amount: fundedAsk,
      text: "What the settled tiers funded from your ballot.",
    },
    {
      key: "waiting",
      from: f(fundedAsk),
      to: f(fundedAsk + waitingAsk),
      className: "stroke-vote-pale",
      swatch: "bg-vote-pale",
      title: "Settled, not funded yet",
      amount: waitingAsk,
      text: "Locked in a settled tier. First in line for what you have left.",
    },
    {
      key: "open",
      from: f(fundedAsk + waitingAsk),
      to: f(asked),
      className: "stroke-dao-green",
      swatch: "bg-dao-green",
      title: anySettled ? "Open tiers" : "Your ballot",
      amount: open,
      text: anySettled ? "Still yours to change." : "What your ballot asks for so far.",
    },
    {
      key: "rest",
      from: f(asked),
      to: 1,
      className: "",
      swatch: "border-2 border-white/30",
      title: "Left to fill",
      amount: target - asked,
      text: `The ring is full at ${dollars(target)}, 3× the ${
        dollars(pool)
      } pool. A ballot needs at least half of it.`,
    },
  ]);
}

/** TheDAO's ring during the vote: gold what the settled tiers awarded, green what the live
 * tally would add if the vote ended now, then (green) what a previewed donation would
 * bring in, then what's left of the pool. */
/** The least a previewed donation's stretch takes of TheDAO's ring. */
const MIN_DONATION = 0.05;

export function poolSegments(
  { settledUsd, mineUsd = 0, nextUsd, liveUsd, previewUsd = 0, pool, liveTone = "green" }: {
    settledUsd: number;
    /** What the tier settling now would award (the rest of the live tally, its later
     * tiers, is `liveUsd`), each without `mineUsd`: two neutrals, this one lighter. */
    nextUsd?: number;
    /** On a ballot's page: what the live tally would award to initiatives on that ballot
     * (green), ahead of the rest of the live tally. */
    mineUsd?: number;
    liveUsd: number;
    /** A previewed donation: what the pool would pay for the initiative given to, its ask
     * less the donation (green). */
    previewUsd?: number;
    pool: number;
    /** The open tiers' share: green, or neutral (the vote results). */
    liveTone?: "green" | "neutral";
  },
): Segment[] {
  const neutral = liveTone === "neutral";
  // The live tally in two neutrals once the tier settling now is told apart.
  const split = nextUsd !== undefined;
  const next = nextUsd ?? 0;
  const f = (usd: number) => (pool > 0 ? usd / pool : 0);
  // What a donation brings in can be small next to the pool ($10K is 1% of $1M): its
  // stretch is drawn at least MIN_DONATION of the way round, so opening an initiative
  // visibly changes the ring; its popup keeps the real amount.
  const before = f(settledUsd + mineUsd + next + liveUsd);
  const donationTo = previewUsd > 0
    ? Math.min(
      1,
      Math.max(before + MIN_DONATION, f(settledUsd + mineUsd + next + liveUsd + previewUsd)),
    )
    : before;
  return fit([
    {
      key: "settled",
      from: 0,
      to: f(settledUsd),
      className: "stroke-vote",
      swatch: "bg-vote",
      title: "Settled",
      amount: settledUsd,
      text: "What the settled tiers awarded, for good.",
    },
    {
      key: "mine",
      from: f(settledUsd),
      to: f(settledUsd + mineUsd),
      className: "stroke-dao-green",
      swatch: "bg-dao-green",
      title: "From your ballot",
      amount: mineUsd,
      text:
        "What the open tiers would award to initiatives on your ballot if they settled now. It can still change.",
    },
    {
      key: "next",
      from: f(settledUsd + mineUsd),
      to: f(settledUsd + mineUsd + next),
      className: "stroke-white/75",
      swatch: "bg-white/75",
      title: "Settling now",
      amount: next,
      text: "What the tier settling now would award if it settled now. It can still change.",
    },
    {
      key: "live",
      from: f(settledUsd + mineUsd + next),
      to: f(settledUsd + mineUsd + next + liveUsd),
      className: neutral ? (split ? "stroke-white/30" : "stroke-white/55") : "stroke-dao-green",
      swatch: neutral ? (split ? "bg-white/30" : "bg-white/55") : "bg-dao-green",
      title: split ? "Later tiers, as they stand" : "If it ended now",
      amount: liveUsd,
      text: split
        ? "What the tiers after it would award if the vote ended now. It can still change."
        : "What the open tiers would award if they settled now. It can still change.",
    },
    {
      key: "preview",
      from: before,
      to: donationTo,
      className: "stroke-dao-green",
      swatch: "bg-dao-green",
      title: "With your donation",
      amount: previewUsd,
      text: "What the pool would pay for the initiative you give to: its ask less your donation.",
    },
    {
      key: "rest",
      from: donationTo,
      to: 1,
      className: "",
      swatch: "border-2 border-white/30",
      title: "Not allocated",
      amount: Math.max(0, pool - settledUsd - mineUsd - next - liveUsd - previewUsd),
      text: `What's left of the ${dollars(pool)} pool.`,
    },
  ]);
}

/** An avatar in a ring of segments, each with a popup on hover (or tap) saying what it
 * means. With `dashedEnd`, the ring's last stretch is dashed: a line that can keep
 * growing past the full ring. */
export function SegmentRing(
  { segments, label, max, now, valueText, dashedEnd, children }: {
    segments: Segment[];
    label: string;
    max: number;
    now: number;
    /** Read before the segments' own lines. */
    valueText: string;
    dashedEnd?: boolean;
    children: React.ReactNode;
  },
) {
  /** The segment in the pointer's direction from the ring's centre, clockwise from the top. */
  const segmentAt = (e: React.MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
    return segments.find((x) => turn >= x.from && turn < x.to)?.key ?? segments.at(-1)?.key;
  };
  /** The segment whose popup is open: by a hover, or by a tap (phones can't hover). */
  const [tip, setTip] = useState<string>();
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tip) return;
    // A tap outside the ring closes a tapped popup.
    const away = (e: PointerEvent) => {
      if (!ring.current?.contains(e.target as Node)) setTip(undefined);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [tip]);
  return (
    <div
      ref={ring}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(now)}
      aria-valuetext={`${valueText} ${
        segments.map((x) => `${x.title}: ${dollars(x.amount)}. ${x.text}`).join(" ")
      }`}
      className="relative grid flex-none place-items-center"
      style={{ width: RING, height: RING }}
    >
      <svg
        width={RING}
        height={RING}
        className="absolute inset-0 -rotate-90 overflow-visible"
        aria-hidden="true"
      >
        <circle
          cx={RING / 2}
          cy={RING / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-white/15"
        />
        {segments.filter((x) => x.className).map((x) => {
          const dim = tip !== undefined && tip !== x.key;
          // Solid up to the ring's last stretch, dashed in it: only a ballot that reaches
          // the end of the ring has dashes, the room to keep adding past it.
          const end = dashedEnd ? 1 - TAIL / C : 1;
          return (
            <g key={x.key}>
              {x.from < end && (
                <Arc
                  from={x.from}
                  to={Math.min(x.to, end)}
                  className={x.className}
                  dim={dim}
                />
              )}
              {x.to > end && (
                <Dashes
                  from={Math.max(x.from, end)}
                  to={x.to}
                  className={x.className}
                  dim={dim}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none grid size-[48px] place-items-center overflow-hidden rounded-full [&_img]:!size-full">
        {children}
      </div>
      <div
        aria-hidden="true"
        data-ring-hit=""
        className="absolute rounded-full"
        style={{ inset: -HIT_MARGIN }}
        onPointerMove={(e) => e.pointerType === "mouse" && setTip(segmentAt(e))}
        onPointerLeave={(e) => e.pointerType === "mouse" && setTip(undefined)}
        onClick={(e) => setTip(segmentAt(e))}
      />
      {segments.map((x) => {
        // The popup points at the middle of its segment, above or below the ring.
        const mid = 2 * Math.PI * (x.from + x.to) / 2;
        const left = RING / 2 + R * Math.sin(mid);
        const top = RING / 2 - R * Math.cos(mid);
        return (
          <Tooltip.Root
            key={x.key}
            open={tip === x.key}
            onOpenChange={(o) => !o && setTip((t) => (t === x.key ? undefined : t))}
          >
            <Tooltip.Trigger
              render={
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute size-px"
                  style={{ left, top }}
                />
              }
            />
            <Tooltip.Portal>
              <Tooltip.Positioner
                side={top < RING / 2 ? "top" : "bottom"}
                sideOffset={10}
                className="z-[210]"
              >
                <Tooltip.Popup
                  data-ring-popup={x.key}
                  className="w-[min(240px,calc(100vw-32px))] rounded-[14px] border border-edge2 bg-panel px-3 py-2 font-inter-tight text-[12.5px] leading-snug text-white shadow-menu outline-none"
                >
                  <p className="m-0 flex items-center gap-2">
                    <span className={cn("size-2 flex-none rounded-full", x.swatch)} />
                    <b className="font-semibold">{x.title}</b>
                    <span className="ml-auto text-white/85 tnum">{dollars(x.amount)}</span>
                  </p>
                  <p className="m-0 mt-1 pl-4 text-white/65">{x.text}</p>
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}
    </div>
  );
}
