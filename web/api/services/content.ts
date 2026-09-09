/**
 * Content as code: an initiative is a markdown file with a small frontmatter
 * header. The filename is the permanent slug. Files own the words and the
 * goal; the admin panel owns the lifecycle.
 */
import { MAX_DETAILS, MAX_SUMMARY, MAX_TITLE } from "../config.ts";
import { parseGoal } from "../lib/validate.ts";
import type { Db } from "../db/mod.ts";
import type { RfpStatus, RfpType } from "../db/types.ts";

export interface ContentFields {
  title: string;
  summary: string;
  details: string;
  goalUsd: number;
  discourseUrl: string;
  status: RfpStatus;
  sortRank: number | null;
  type: RfpType;
}

/** Parse '---' frontmatter then markdown details. Indented lines continue a value. */
export function parseRfpFile(text: string): ContentFields {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("missing '---' frontmatter block");
  const [, head, body] = m;
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line) && key) {
      fields[key] += " " + line.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx <= 0 || !line.slice(0, idx).trim()) {
      throw new Error(`bad frontmatter line: ${JSON.stringify(line)}`);
    }
    key = line.slice(0, idx).trim().toLowerCase();
    fields[key] = line.slice(idx + 1).trim();
  }
  const title = fields.title ?? "";
  if (title.length < 1 || title.length > MAX_TITLE) {
    throw new Error(`title is required (max ${MAX_TITLE} chars)`);
  }
  const [goal, err] = parseGoal(fields.goal ?? "");
  if (err) throw new Error(err);
  const status = (fields.status ?? "approved").toLowerCase();
  if (status !== "approved" && status !== "pending") {
    throw new Error("status must be approved or pending");
  }
  const pin = (fields.pin ?? "").trim();
  if (pin && !/^\d+$/.test(pin)) throw new Error("pin must be a whole number");
  const type = (fields.type ?? "rfp").toLowerCase();
  if (type !== "rfp" && type !== "grant") throw new Error("type must be rfp or grant");
  return {
    title,
    summary: (fields.summary ?? "").slice(0, MAX_SUMMARY),
    details: body.trim().slice(0, MAX_DETAILS),
    goalUsd: goal!,
    discourseUrl: fields.forum ?? "",
    status,
    sortRank: pin ? Number(pin) : null,
    type,
  };
}

export const slugFromFilename = (name: string): string =>
  name.replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );

export interface SyncResult {
  created: number;
  updated: number;
  errors: string[];
}

/** Upsert every file; bad files are reported and skipped, never blocking. */
export const TERMS_FILE = "donation-terms.md";
const TERMS_VERSION_RE = /^version:[ \t]*(\S+)[ \t]*\r?\n/i;

/**
 * content/donation-terms.md: the first line `version: YYYY-MM-DD` is the gate
 * version (the donate widget re-asks whenever it changes); it is stripped from
 * the body, which carries its own effective date.
 */
export function parseTermsFile(text: string): { version: string; body: string } {
  const m = TERMS_VERSION_RE.exec(text);
  if (!m) throw new Error("first line must be `version: <id>`");
  const body = text.slice(m[0].length).trim();
  if (!body) throw new Error("terms body is empty");
  return { version: m[1].slice(0, 40), body };
}

export async function syncContent(
  db: Db,
  files: { name: string; text: string }[],
): Promise<SyncResult> {
  const out: SyncResult = { created: 0, updated: 0, errors: [] };
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!f.name.endsWith(".md") || f.name === "README.md") continue;
    if (f.name === TERMS_FILE) {
      try {
        const t = parseTermsFile(f.text);
        const cur = await db.terms.get();
        await db.terms.set(t.version, t.body);
        if (cur) out.updated++;
        else out.created++;
      } catch (e) {
        out.errors.push(`${f.name}: ${(e as Error).message}`);
      }
      continue;
    }
    const slug = slugFromFilename(f.name);
    if (!slug) {
      out.errors.push(`${f.name}: filename makes an empty slug`);
      continue;
    }
    try {
      const fields = parseRfpFile(f.text);
      const r = await db.rfps.upsertContent(slug, fields);
      if (r === "created") out.created++;
      else out.updated++;
    } catch (e) {
      out.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return out;
}
