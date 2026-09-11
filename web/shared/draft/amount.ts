/**
 * One reader for every money field. "150,000" and "150.000" are 150000;
 * "150,00" and "150.00" are 150; with mixed separators the last one is the
 * decimal point. Anything else (currency symbols, words) is dropped first; a
 * value with no digits is 0.
 */
export function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").replace(/[^0-9.,]/g, "");
  if (!s) return 0;
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let n: number;
  if (last < 0) n = Number(s);
  else if (/^\d{1,2}$/.test(s.slice(last + 1))) {
    n = Number(s.slice(0, last).replace(/[.,]/g, "") + "." + s.slice(last + 1));
  } else n = Number(s.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "$150,000", or "$1,234.50" when there are cents. */
export function usd(n: unknown): string {
  const v = typeof n === "number" ? n : parseAmount(n);
  const cents = Math.abs(v % 1) > 0.004;
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}
