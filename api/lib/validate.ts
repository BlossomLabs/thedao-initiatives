/** Input validation shared by the submit form, the proposer's edit page and the admin editor. */
import { HttpError } from "./errors.ts";
import { MAX_DETAILS, MAX_SUMMARY, MAX_TITLE } from "../config.ts";
import { LIMITS, tooLong } from "../../shared/draft/mod.ts";

export const MIN_TITLE = 8;
export const MIN_SUMMARY = 40;

/** Trim a text field, keeping one character past its limit so the checks can
 * report "too long" instead of the tail vanishing; the same everywhere the
 * text is written. */
export function cleanText(v: unknown, field: "title" | "summary" | "details"): string {
  const max = field === "title" ? MAX_TITLE : field === "summary" ? MAX_SUMMARY : MAX_DETAILS;
  return String(v ?? "").trim().slice(0, max + 1);
}

/** A capped text field: refused with the shared "too long" message, never cut. */
export function capped(v: unknown, cap: number, label: string): string {
  const t = String(v ?? "").trim().slice(0, cap + 1);
  if (t.length > cap) throw new HttpError(400, tooLong(label, cap));
  return t;
}

/**
 * The three revisioned fields, validated together (title >= 8 chars, summary
 * >= 40 chars, details optional). Throws a 400 with the user-facing message.
 */
export function validateText(
  text: { title: string; summary: string; details: string },
): { title: string; summary: string; details: string } {
  const title = cleanText(text.title, "title");
  if (title.length < MIN_TITLE) {
    throw new HttpError(400, `Title needs at least ${MIN_TITLE} characters.`);
  }
  if (title.length > MAX_TITLE) throw new HttpError(400, tooLong("The title", MAX_TITLE));
  const summary = cleanText(text.summary, "summary");
  if (summary.length < MIN_SUMMARY) {
    throw new HttpError(400, `Summary needs at least ${MIN_SUMMARY} characters.`);
  }
  if (summary.length > MAX_SUMMARY) throw new HttpError(400, tooLong("The summary", MAX_SUMMARY));
  const details = cleanText(text.details, "details");
  if (details.length > MAX_DETAILS) throw new HttpError(400, tooLong("The details", MAX_DETAILS));
  return { title, summary, details };
}

export function parseGoal(raw: unknown): [number, null] | [null, string] {
  const s = String(raw ?? "").replace(/,/g, "").replace(/\$/g, "").trim();
  const v = Number(s);
  if (!s || !Number.isFinite(v)) return [null, "Funding goal must be a number (USD)."];
  if (!(v > 0 && v <= 100_000_000)) {
    return [null, "Funding goal must be between $1 and $100,000,000."];
  }
  return [Math.round(v * 100) / 100, null];
}

const FORUM_HOST_RE = /^[a-z0-9.-]+$/;

function ipIsPublic(ip: string): boolean {
  if (ip.includes(":")) {
    const low = ip.toLowerCase();
    if (low === "::" || low === "::1") return false;
    if (/^(fc|fd|fe[89ab])/.test(low)) return false; // ULA, link-local
    if (low.startsWith("::ffff:")) return ipIsPublic(low.slice(7));
    if (low.startsWith("ff")) return false; // multicast
    return true;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/**
 * Resolve a host and return its IPs only if EVERY one is public.
 * Returns [ips, null] or [null, reason].
 */
export async function resolvePublicIps(
  host: string,
): Promise<[string[], null] | [null, string]> {
  let ips: string[] = [];
  try {
    const [a, aaaa] = await Promise.allSettled([
      Deno.resolveDns(host, "A"),
      Deno.resolveDns(host, "AAAA"),
    ]);
    if (a.status === "fulfilled") ips = ips.concat(a.value);
    if (aaaa.status === "fulfilled") ips = ips.concat(aaaa.value);
  } catch {
    return [null, "host does not resolve"];
  }
  if (ips.length === 0) return [null, "host does not resolve"];
  for (const ip of ips) {
    if (!ipIsPublic(ip)) return [null, "host resolves to a non-public address"];
  }
  return [ips, null];
}

/** Accept an https discussion link: a (Discourse) forum topic or a Telegram group. */
export async function validateForumUrl(
  raw: unknown,
  resolve: typeof resolvePublicIps = resolvePublicIps,
): Promise<[string, null] | [null, string]> {
  const s = String(raw ?? "").trim();
  if (!s) return [null, "A discussion link is required."];
  if (s.length > LIMITS.LINK_CHARS) {
    return [null, tooLong("The discussion link", LIMITS.LINK_CHARS)];
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return [null, "That does not look like a valid URL."];
  }
  if (u.protocol !== "https:") return [null, "The discussion link must be https."];
  const host = u.hostname.toLowerCase();
  if (!host || !FORUM_HOST_RE.test(host) || !host.includes(".")) {
    return [null, "That does not look like a valid discussion link host."];
  }
  const [ips] = await resolve(host);
  if (!ips) return [null, "That discussion link host is not reachable."];
  u.hash = "";
  return [u.toString(), null];
}

export const MAX_DURATION_MONTHS = 120;

/** Whole months from funding to the last milestone; blank means "not stated". */
export function parseDuration(raw: unknown): [number | null, null] | [null, string] {
  const s = String(raw ?? "").trim();
  if (!s) return [null, null];
  if (!/^\d+$/.test(s)) return [null, "Duration must be a whole number of months."];
  const n = Number(s);
  if (n < 1 || n > MAX_DURATION_MONTHS) {
    return [null, `Duration must be between 1 and ${MAX_DURATION_MONTHS} months.`];
  }
  return [n, null];
}

/**
 * An https link the page renders as an anchor (recipient team site, backer
 * site). Only the scheme and host shape are checked; nothing fetches it
 * server-side. The cap is the form's, so every writer of a link agrees.
 */
export function validateHttpsLink(raw: unknown): [string, null] | [null, string] {
  const s = String(raw ?? "").trim();
  if (!s) return ["", null];
  if (s.length > LIMITS.LINK_CHARS) return [null, tooLong("The link", LIMITS.LINK_CHARS)];
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return [null, "That does not look like a valid URL."];
  }
  if (u.protocol !== "https:") return [null, "The link must be https."];
  const host = u.hostname.toLowerCase();
  if (!host || !FORUM_HOST_RE.test(host) || !host.includes(".")) {
    return [null, "That does not look like a valid link host."];
  }
  return [u.toString(), null];
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
export { NICK_RE } from "../../shared/profile.ts";
export const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const PRESET_RE = /^preset:[0-9]$/;

export function str(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

/** Image magic-byte sniffing (png/jpg/webp only). Returns ext or null. */
export function imageExt(blob: Uint8Array): "png" | "jpg" | "webp" | null {
  const starts = (sig: number[]) => sig.every((b, i) => blob[i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpg";
  if (
    starts([0x52, 0x49, 0x46, 0x46]) &&
    new TextDecoder().decode(blob.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}
