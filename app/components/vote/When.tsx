import { useEffect, useState } from "react";
import { clock, dayTime } from "~/lib/format";

/** The vote's dates: in the reader's own time zone, with UTC in the hover title, and a
 * live countdown where a deadline matters. Times are unix seconds. */

/** "Nov 16, 18:00" (or just "18:00"), in the reader's time zone. */
export const localTime = (secs: number, withDay = true) => withDay ? dayTime(secs) : clock(secs);
/** "Nov 16, 18:00 UTC": only in the hover title. */
export const utcTime = (secs: number) => `${dayTime(secs, true)} UTC`;

/** The vote page's clock, in ms: the real one, or a dev mock's moment in the round, still
 * ticking (mock-round.ts). */
let offset = 0;
export const voteNow = () => Date.now() + offset;
/** Runs the clock from `atMs` (a mock's moment), or back on the real time with null. */
export function setVoteClock(atMs: number | null) {
  offset = atMs === null ? 0 : atMs - Date.now();
}

/** Now, in ms, ticking every `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => voteNow());
  useEffect(() => {
    setNow(voteNow());
    const t = setInterval(() => setNow(voteNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "2d 4h", "4h 12m", "12m 05s"; null once it's due. */
export function timeLeft(secs: number): string | null {
  if (secs <= 0) return null;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** A date in local time, as a <time> with UTC in its title. */
export function When({ at, withDay = true }: { at: number; withDay?: boolean }) {
  return (
    <time dateTime={new Date(at * 1000).toISOString()} title={utcTime(at)}>
      {localTime(at, withDay)}
    </time>
  );
}

/** "in 2d 4h", live; nothing once it's due. */
export function Countdown({ to, className }: { to: number; className?: string }) {
  const now = useNow();
  const left = timeLeft(to - Math.floor(now / 1000));
  if (!left) return null;
  return (
    <span className={className ?? "tnum text-white/60"} role="timer">
      in {left}
    </span>
  );
}

/** A deadline: its local date, then "(in 2d 4h)" while it's ahead. */
export function Deadline({ at, withDay = true }: { at: number; withDay?: boolean }) {
  const now = useNow();
  const left = timeLeft(at - Math.floor(now / 1000));
  return (
    <>
      <When at={at} withDay={withDay} />
      {left && (
        <>
          {" "}
          <span className="whitespace-nowrap tnum text-white/60" role="timer">(in {left})</span>
        </>
      )}
    </>
  );
}
