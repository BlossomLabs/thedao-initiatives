/** Ports of the MVP's jinja filters (app.py:260-282). */

export function usd(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0";
  if (n <= 0) return "$0";
  if (n >= 1000) return "$" + Math.round(n).toLocaleString("en-US");
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Money in a few characters, for tight spots: $274, $1.1k, $100k, $1.3M. */
export function usdShort(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "$0";
  const trim = (x: number, digits: number) => String(Number(x.toFixed(digits)));
  if (n < 999.5) return `$${Math.round(n)}`;
  if (n < 999_500) return `$${trim(n / 1000, n < 9_950 ? 1 : 0)}k`;
  return `$${trim(n / 1_000_000, 1)}M`;
}

export function shortAddr(a: string | null | undefined): string {
  return a && a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a ?? "";
}

/** "Nov 1, 2026". */
export function dt(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* Dates near now, in the reader's time zone: "Nov 1, 14:00". No weekday, no year,
 * no time zone name, 24-hour clock. `utc: true` reads the same instant in UTC. */
const fmt = (opts: Intl.DateTimeFormatOptions) => ({
  local: new Intl.DateTimeFormat("en-US", { ...opts, hourCycle: "h23" }),
  utc: new Intl.DateTimeFormat("en-US", { ...opts, hourCycle: "h23", timeZone: "UTC" }),
});
const DAY = fmt({ month: "short", day: "numeric" });
const CLOCK = fmt({ hour: "2-digit", minute: "2-digit" });
/** "Nov 1". */
export const shortDay = (secs: number, utc = false) =>
  DAY[utc ? "utc" : "local"].format(secs * 1000);
/** "14:00". */
export const clock = (secs: number, utc = false) =>
  CLOCK[utc ? "utc" : "local"].format(secs * 1000);
/** "Nov 1, 14:00". */
export const dayTime = (secs: number, utc = false) =>
  `${shortDay(secs, utc)}, ${clock(secs, utc)}`;

/** "just now", "4 min ago", "3 h ago", or the date for anything older than a day. */
export function ago(ts: number, now: number = Date.now() / 1000): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dt(ts);
}

export const pct = (total: number, goal: number): number =>
  goal ? Math.min(100, Math.round((1000 * total) / goal) / 10) : 0;

/** "63.8%" style, always one decimal like the MVP's jinja output. */
export const pctText = (p: number): string => `${p.toFixed(1)}%`;

export const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + "…" : s);

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2026-11" → "Nov 2026" (a milestone's target month); anything else unchanged. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month ?? "").trim());
  if (!m) return month;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
