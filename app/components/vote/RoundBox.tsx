import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import type { RoundView } from "~/hooks/use-vote";
import { clock, dayTime, usd, usdShort } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type Tier, tierName } from "../../../shared/vote/ballot";
import type { Schedule } from "../../../shared/vote/quiet-ending";
import { type Phase, roundSteps, type Step, type Win } from "./round-steps";
import { Countdown, useNow, When } from "./When";

/** Where the round is: a stepper (Voting → Tier-S → Tier-A → Tier-B → Result), the
 * current step in detail (a settling tier's windows in a bar, each with its own popup),
 * and on the ballot one line about what this badge can still do. */

export type BadgeTone = "todo" | "ok" | "muted";
export type BadgeLine = { tone: BadgeTone; text: string };

/** The ballot's line about this badge, from where the round is. */
export function badgeLine(
  { phase, counted, shut = false, settled }: {
    phase: Phase;
    /** This badge has a ballot that counts. */
    counted: boolean;
    /** The round no longer takes this badge's first ballot (Tier-S settled first). */
    shut?: boolean;
    /** The tiers settled so far, in order. */
    settled: Tier[];
  },
): BadgeLine {
  if (phase.kind === "before") {
    return { tone: "muted", text: "You can arrange your ballot now. Sending opens with the vote." };
  }
  if (!counted) {
    if (shut || settled.includes("S")) {
      return {
        tone: "muted",
        text:
          "Tier-S settled before this badge voted, so it can’t vote this round. You can still follow the result.",
      };
    }
    return {
      tone: "todo",
      text: phase.kind === "settling"
        ? "This badge hasn’t voted yet. There is still time: send a first ballot before Tier-S settles."
        : "This badge hasn’t voted yet. Send a first ballot before Tier-S settles, or it won’t be able to vote.",
    };
  }
  if (settled.length === 0) {
    return { tone: "ok", text: "Your ballot counts. You can still change every tier." };
  }
  const open = (["S", "A", "B"] as Tier[]).filter((t) => !settled.includes(t));
  const names = (ts: Tier[]) => ts.map(tierName).join(" and ");
  return {
    tone: "ok",
    text: open.length
      ? `${names(settled)} ${settled.length > 1 ? "are" : "is"} locked. ${names(open)} ${
        open.length > 1 ? "are" : "is"
      } still yours to change.`
      : "Every tier has settled.",
  };
}

const TONE: Record<BadgeTone, { box: string; dot: string }> = {
  todo: { box: "bg-amber-300/[.08] text-amber-200", dot: "bg-amber-300" },
  ok: { box: "bg-dao-green/[.08] text-[#a7e3a5]", dot: "bg-dao-green" },
  muted: { box: "bg-white/[.03] text-white/60", dot: "bg-white/40" },
};

const FILL: Record<Win["kind"], string> = {
  past: "bg-white/40",
  current: "bg-dao-green",
  coming:
    "bg-[repeating-linear-gradient(135deg,var(--color-dao-green)_0_3px,rgba(92,183,90,.25)_3px_6px)]",
  maybe: "bg-white/[.12]",
};

/** "24h", "1h 30m", "22m 30s", "42s": at most two units. */
export function length(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** A local time with seconds when a window is that short: "20:59:52". */
const endAt = (t: number, len: number) =>
  len < 120 ? `${clock(t)}:${String(t % 60).padStart(2, "0")}` : clock(t);

/** Windows from the 4th on are short (3h, 1h 30m… down to 5m 37s): one block on the bar. */
const GROUP_FROM = 3;
type Seg = { first: number; last: number };
/** The bar's blocks: windows 1, 2 and 3 alone, then the rest together (when 2 or more). */
export function windowSegments(n: number): Seg[] {
  if (n - GROUP_FROM < 2) return Array.from({ length: n }, (_, i) => ({ first: i, last: i }));
  return [
    ...Array.from({ length: GROUP_FROM }, (_, i) => ({ first: i, last: i })),
    { first: GROUP_FROM, last: n - 1 },
  ];
}

/** What a window's popup says: its tag and one line on what happened or can happen. */
function windowText(
  p: Extract<Phase, { kind: "settling" }>,
  i: number,
): { tag: string; note: string } {
  const name = tierName(p.tier);
  const w = p.windows[i];
  const n = p.windows.length;
  const at = endAt(p.endsAt, w.to - w.from);
  if (w.kind === "past") {
    return {
      tag: "done",
      note: `${name} changed in it, so ${
        i + 2 === n ? "the last window" : `window ${i + 2}`
      } followed.`,
    };
  }
  if (w.kind === "current") {
    if (p.last) {
      return { tag: "now", note: `The last window: ${name} settles at ${at} whatever happens.` };
    }
    return p.quiet
      ? { tag: "now", note: `No change so far. If it stays that way, ${name} settles at ${at}.` }
      : { tag: "now", note: `${name} changed in it, so window ${i + 2} will follow.` };
  }
  if (w.kind === "coming") {
    return { tag: "will follow", note: `Will run: ${name} changed in window ${i}.` };
  }
  const lastOne = i === n - 1;
  return {
    tag: lastOne ? "last one, if needed" : "",
    note:
      (i === p.window
        ? `Runs only if ${name} changes in window ${i}.`
        : `Runs only if window ${i} changes too.`) +
      (lastOne ? ` ${name} settles at its end whatever happens.` : ""),
  };
}

/** A block's popup: its title, tag and note, and for the short windows one row each. */
function segText(p: Extract<Phase, { kind: "settling" }>, seg: Seg) {
  const ws = p.windows.slice(seg.first, seg.last + 1);
  const total = ws.reduce((a, w) => a + w.to - w.from, 0);
  if (seg.first === seg.last) {
    return { title: `Window ${seg.first + 1} · ${length(total)}`, ...windowText(p, seg.first) };
  }
  const name = tierName(p.tier);
  const title = `Windows ${seg.first + 1}–${seg.last + 1}`;
  const cur = ws.findIndex((w) => w.kind === "current");
  if (cur >= 0) {
    const { note } = windowText(p, seg.first + cur);
    return { title, tag: `now: window ${seg.first + cur + 1}`, note };
  }
  if (ws.every((w) => w.kind === "past")) {
    return { title, tag: "done", note: `${name} changed in each, so every window ran.` };
  }
  const rest = `${name} settles at the end of window ${seg.last + 1} whatever happens.`;
  if (ws[0].kind === "coming") {
    return { title, tag: "will follow", note: `Window ${seg.first + 1} will run. ${rest}` };
  }
  return { title, tag: "", note: rest };
}

const TAG_ON = (kind: Win["kind"]) =>
  kind === "current" || kind === "coming"
    ? "bg-dao-green/20 text-[#a7e3a5]"
    : "bg-white/10 text-white/70";

/** A settling tier's windows, each sized by its length, with its own popup (hover, focus
 * or tap). Windows 4 and on share one block: alone they'd be slivers. */
function WindowBar({ phase }: { phase: Extract<Phase, { kind: "settling" }> }) {
  const [open, setOpen] = useState<number>();
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === undefined) return;
    // A tap outside the bar closes a tapped popup.
    const away = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(undefined);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const segs = windowSegments(phase.windows.length);
  const span = (seg: Seg) => phase.windows[seg.last].to - phase.windows[seg.first].from;
  const kindOf = (seg: Seg): Win["kind"] => {
    const ks = phase.windows.slice(seg.first, seg.last + 1).map((w) => w.kind);
    return ks.includes("current")
      ? "current"
      : ks[0] === "coming"
      ? "coming"
      : ks.every((k) => k === "past")
      ? "past"
      : "maybe";
  };
  return (
    <div ref={bar} data-window-bar="">
      <div className="flex gap-1">
        {segs.map((seg, j) => {
          const { title, tag, note } = segText(phase, seg);
          const kind = kindOf(seg);
          const ws = phase.windows.slice(seg.first, seg.last + 1);
          const group = ws.length > 1;
          return (
            <Tooltip.Root
              key={j}
              open={open === j}
              onOpenChange={(o) => setOpen((v) => (o ? j : v === j ? undefined : v))}
            >
              <Tooltip.Trigger
                delay={150}
                closeOnClick={false}
                render={
                  <button
                    type="button"
                    aria-label={`${tierName(phase.tier)} ${title}${tag ? `, ${tag}` : ""}`}
                    data-window={kind}
                    onClick={() => setOpen(j)}
                    className="group/w flex min-w-0 flex-col gap-1.5 rounded-md py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    style={{ flex: `${span(seg)} 1 0` }}
                  />
                }
              >
                <span
                  className={cn(
                    "flex h-2 w-full gap-px overflow-hidden rounded-full transition-shadow",
                    open === j
                      ? "shadow-[0_0_0_2px_rgba(255,255,255,.55)]"
                      : "group-hover/w:shadow-[0_0_0_1px_rgba(255,255,255,.35)]",
                  )}
                >
                  {ws.map((w, k) => (
                    <span
                      key={k}
                      className={cn("block h-full min-w-px", FILL[w.kind])}
                      style={{ flex: `${w.to - w.from} 1 0` }}
                    />
                  ))}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap font-inter-tight text-[11.5px] leading-none tnum",
                    group && "flex w-full justify-between gap-1",
                    kind === "current" ? "font-semibold text-white" : "text-white/50",
                  )}
                >
                  {group
                    ? (
                      <>
                        {/* "3h … 5m": the first and last lengths at the block's ends. */}
                        <span>{length(ws[0].to - ws[0].from).split(" ")[0]}</span>
                        <span aria-hidden="true">…</span>
                        <span>{length(ws.at(-1)!.to - ws.at(-1)!.from).split(" ")[0]}</span>
                      </>
                    )
                    : length(span(seg))}
                </span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner side="bottom" sideOffset={6} className="z-[210]">
                  <Tooltip.Popup
                    data-window-popup={j}
                    className="w-[min(290px,calc(100vw-32px))] space-y-1.5 rounded-[14px] border border-edge2 bg-panel px-3 py-2.5 font-inter-tight text-[12.5px] leading-snug text-white shadow-menu outline-none"
                  >
                    <p className="m-0 flex items-center gap-2">
                      <span className={cn("size-2.5 flex-none rounded-[3px]", FILL[kind])} />
                      <b className="font-semibold">{title}</b>
                      {tag && (
                        <span
                          className={cn(
                            "ml-auto flex-none rounded-full px-1.5 text-[11px]",
                            TAG_ON(kind),
                          )}
                        >
                          {tag}
                        </span>
                      )}
                    </p>
                    <p className="m-0 pl-[18px] text-white/85 tnum">
                      {dayTime(ws[0].from)} → {group ? dayTime(ws.at(-1)!.to) : dayTime(ws[0].to)}
                    </p>
                    {group && (
                      <ol className="m-0 max-h-[200px] list-none space-y-px overflow-y-auto p-0 pl-[18px] tnum">
                        {ws.map((w, k) => {
                          const len = w.to - w.from;
                          return (
                            <li
                              key={k}
                              data-window-row={w.kind}
                              className={cn(
                                "grid grid-cols-[5rem_4.2rem_1fr] items-center gap-1 rounded px-1 text-[12px]",
                                w.kind === "current"
                                  ? "bg-dao-green/15 text-white"
                                  : "text-white/70",
                              )}
                            >
                              <span className="flex items-center gap-1">
                                <span className={cn("size-1.5 rounded-full", FILL[w.kind])} />
                                Window {seg.first + k + 1}
                              </span>
                              <span>{length(len)}</span>
                              <span className="text-right">ends {endAt(w.to, len)}</span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                    <p className="m-0 pl-[18px] text-white/65">{note}</p>
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </div>
    </div>
  );
}

function Stepper({ steps, at, large }: { steps: Step[]; at: number; large?: boolean }) {
  const current = steps.findIndex((s) => s.kind === "current" || s.kind === "next");
  const dot = large ? "size-7" : "size-[22px]";
  return (
    <div>
      <ol className="relative m-0 grid list-none grid-cols-5 p-0" aria-label="Where the round is">
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-[10%] h-0.5 bg-white/[.16]",
            large ? "top-[13px]" : "top-[10px]",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-[10%] h-0.5 bg-dao-green transition-[width] duration-500",
            large ? "top-[13px]" : "top-[10px]",
          )}
          style={{ width: `${at * 20}%` }}
        />
        {steps.map((s) => (
          <li
            key={s.name}
            aria-current={s.kind === "current" ? "step" : undefined}
            className="relative flex min-w-0 flex-col items-center gap-1.5 text-center"
          >
            <span
              className={cn(
                "relative grid place-items-center rounded-full",
                dot,
                s.kind === "done" && "bg-dao-green",
                s.kind === "current" &&
                  "border-2 border-dao-green bg-[#25506f] shadow-[0_0_0_5px_rgba(92,183,90,.18)]",
                s.kind === "next" && "border-2 border-dashed border-white/45 bg-[#25506f]",
                s.kind === "up" && "border-2 border-white/25 bg-[#25506f]",
              )}
            >
              {s.kind === "done" && (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2.5 6.2l2.3 2.3 4.7-4.9"
                    fill="none"
                    stroke="#14304a"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {s.kind === "current" && <span className="size-2 rounded-full bg-dao-green" />}
            </span>
            <span
              className={cn(
                "font-inter-tight",
                large ? "text-[14px]" : "text-[13px]",
                s.kind === "current"
                  ? "font-bold text-white"
                  : s.kind === "done"
                  ? "font-semibold text-white/85 max-sm:hidden"
                  : "font-medium text-white/60 max-sm:hidden",
              )}
            >
              {s.name}
            </span>
            <span
              className={cn(
                "leading-tight text-white/55 tnum max-sm:hidden",
                large ? "text-[12.5px]" : "text-[11.5px]",
              )}
            >
              {s.sub}
            </span>
          </li>
        ))}
      </ol>
      {current >= 0 && (
        <p className="m-0 mt-2 text-center text-[12px] text-white/60 sm:hidden">
          Step {current + 1} of 5 · {steps[current].sub}
        </p>
      )}
    </div>
  );
}

export default function RoundBox(
  { schedule, rv, badge, mine, large, stepsOnly }: {
    schedule: Schedule;
    rv?: RoundView;
    /** On the ballot: what this badge can still do. */
    badge?: BadgeLine;
    /** On the ballot, between tiers: what the settled tier took from this ballot. */
    mine?: { onBallot: number; paidUsd: number; shareUsd?: number };
    /** The results page's header: a little bigger. */
    large?: boolean;
    /** The "your ballot" page: a title (where the round is, with its countdown) over the
     * stepper and what this badge can still do, without the tier settling now. */
    stepsOnly?: boolean;
  },
) {
  const now = Math.floor(useNow(30_000) / 1000);
  const { phase, steps, at } = roundSteps({
    schedule,
    tiers: rv?.tiers,
    now,
    closed: rv?.closed,
  });
  let title: React.ReactNode;
  let to: number | undefined;
  let when: React.ReactNode = null;
  let status: React.ReactNode = null;
  switch (phase.kind) {
    case "before":
      title = (
        <>
          Voting opens <When at={phase.opensAt} />
        </>
      );
      to = phase.opensAt;
      when = (
        <>
          Tier-S starts settling <When at={phase.sStarts} />.
        </>
      );
      break;
    case "open":
      title = "Voting is open";
      to = phase.sStarts;
      when = (
        <>
          Tier-S starts settling <When at={phase.sStarts} />.
        </>
      );
      status =
        "Every tier can change until it settles. Tier-S settles first, then Tier-A, then Tier-B.";
      break;
    case "settling": {
      const name = tierName(phase.tier);
      title = `${name} is settling`;
      to = phase.endsAt;
      const ends = <When at={phase.endsAt} withDay={false} />;
      status = phase.last
        ? <>The last window: {name} settles at {ends} whatever happens.</>
        : phase.quiet
        ? <>No change so far: {name} settles when this window ends, at {ends}.</>
        : <>{name} changed in this window: a shorter window follows at {ends}.</>;
      break;
    }
    case "between":
      title = `${tierName(phase.settled)} settled: ${phase.funded.length} ${
        phase.funded.length === 1 ? "initiative" : "initiatives"
      }, ${usdShort(phase.fundedUsd)}`;
      to = phase.nextStarts;
      when = (
        <>
          {tierName(phase.next)} starts settling <When at={phase.nextStarts} />.
        </>
      );
      if (mine) {
        status = `${mine.onBallot} of the ${phase.funded.length} ${
          mine.onBallot === 1 ? "was" : "were"
        } on your ballot.${
          mine.paidUsd > 0
            ? ` You paid ${usd(mine.paidUsd)}${
              mine.shareUsd ? ` of your ${usd(mine.shareUsd)} share` : ""
            }.`
            : ""
        }`;
      }
      break;
    case "closed":
      title = "The vote has ended";
      break;
  }
  const tone = badge && TONE[badge.tone];
  const BOX = "overflow-visible rounded-xl border border-white/15 bg-white/[.04] text-left";
  const stepper = (
    <div className={cn(large ? "px-5 pb-4 pt-5" : "px-4 pb-3.5 pt-4")}>
      <Stepper steps={steps} at={at} large={large} />
    </div>
  );
  const badgeLineEl = badge && tone && (
    <p
      role="status"
      className={cn(
        "m-0 flex items-start gap-2.5 rounded-b-xl border-t border-white/10 px-4 py-3 text-[13.5px] leading-snug",
        tone.box,
      )}
    >
      <span className={cn("mt-[6px] size-[7px] flex-none rounded-full", tone.dot)} />
      <span>{badge.text}</span>
    </p>
  );
  const titleRow = (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="m-0 font-inter-tight text-[16px] font-semibold tracking-[-.01em] text-white">
        {title}
      </h2>
      {to !== undefined && (
        <Countdown
          to={to}
          className="flex-none rounded-full border border-white/20 px-2.5 py-0.5 text-[12px] text-white/80 tnum"
        />
      )}
    </div>
  );
  const nowBox = () => (
    <div className="space-y-2 border-t border-white/10 px-4 pb-4 pt-3.5">
      {titleRow}
      {when && <p className="m-0 text-[13.5px] text-white/75 tnum">{when}</p>}
      {phase.kind === "settling" && <WindowBar phase={phase} />}
      {status && <p className="m-0 text-[13.5px] leading-snug text-white/65">{status}</p>}
    </div>
  );
  return (
    <section aria-label="Where the round is" className={BOX}>
      {stepsOnly && <div className="border-b border-white/10 px-4 pb-3 pt-3.5">{titleRow}</div>}
      {stepper}
      {!stepsOnly && nowBox()}
      {badgeLineEl}
    </section>
  );
}
