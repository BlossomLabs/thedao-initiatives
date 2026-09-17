/**
 * Content as code: an initiative is a markdown file with a small frontmatter
 * header. The filename is a permanent source key; its original proposal ID
 * survives public URL changes. Files own words and goal; admins own lifecycle.
 */
import { MAX_SUMMARY, MAX_TITLE } from "../config.ts";
import { parseDuration, parseGoal, validateHttpsLink } from "../lib/validate.ts";
import type { Db } from "../db/mod.ts";
import type { RfpStatus, RfpType } from "../db/types.ts";
import {
  criterionTooLong,
  FIELDS,
  letter,
  LIMITS,
  type Milestone,
  milestonesTotal,
  normaliseStructured,
  parseBackers,
  type PastedBacker,
  type SectionKey,
  SECTIONS,
  type Sections,
  splitDraft,
  type Structured,
  structuredBytes,
  TOO_LONG_MSG,
  tooLong,
  usd,
} from "../../shared/draft/mod.ts";

export interface ContentFields {
  title: string;
  summary: string;
  /** Always "" since the strict parser: content files must be structured. */
  details: string;
  sections: Sections;
  milestones: Milestone[];
  links: string[];
  goalUsd: number;
  discourseUrl: string;
  status: RfpStatus;
  sortRank: number | null;
  type: RfpType;
  durationMonths: number | null;
  recipientTeam: string;
  recipientUrl: string;
  topup: boolean;
  milestoneReviewer: string;
  /** `backers:` block, one 'Org | $amount | https://link' per line. */
  backers: PastedBacker[];
}

/** Frontmatter keys whose indented continuation lines stay separate lines. */
const LINE_KEYS = new Set(["backers"]);

/**
 * The `backers:` block: an org per line, an amount each, an https link at most,
 * no org twice. The same line format the guide asks for under "Backers".
 */
export function parseContentBackers(raw: string): PastedBacker[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = parseBackers(lines.join("\n"));
  if (out.length !== lines.length) {
    throw new Error("backers: each line is 'Org | $amount | https://link' (link optional)");
  }
  if (out.length > LIMITS.BACKERS) throw new Error(`backers: at most ${LIMITS.BACKERS}`);
  const seen = new Set<string>();
  for (const b of out) {
    if (!b.org) throw new Error("backers: a line has no organization");
    if (b.org.length > 120) throw new Error(`backers: ${b.org.slice(0, 40)}… is too long`);
    if (!(b.amountUsd > 0)) throw new Error(`backers: ${b.org} needs an amount`);
    const [url, err] = validateHttpsLink(b.url);
    if (err) throw new Error(`backers: ${b.org}: ${err}`);
    b.url = url!;
    if (b.logo && !LOGO_NAME_RE.test(b.logo)) {
      throw new Error(
        `backers: ${b.org}: the logo is a file name in content/rfps/logos (png, jpg or webp), got "${b.logo}"`,
      );
    }
    const k = b.org.toLowerCase();
    if (seen.has(k)) throw new Error(`backers: ${b.org} is listed twice`);
    seen.add(k);
  }
  return out;
}

/** content/rfps/logos/<name>: lowercase, no paths. */
export const LOGO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.(png|jpe?g|webp)$/;

/** Looks up the pinned CID for a content logo name; null when never uploaded. */
export type LogoResolver = (name: string) => Promise<string | null>;

/**
 * The body must split cleanly into the guide's sections and milestones:
 * every section of the type, at least one milestone each with an amount and
 * a criterion, amounts summing to the goal, no other-type sections, no text
 * outside a known heading. Otherwise the reasons (v1's wording) are thrown.
 */
export function parseStructuredBody(body: string, type: RfpType, goal: number): Structured {
  const res = splitDraft(body, type);
  const reasons: string[] = [];
  const missing = SECTIONS[type].filter((k) => !(res.fields[k] ?? "").trim());
  if (missing.length) reasons.push("missing: " + missing.map((k) => FIELDS[k].heading).join(", "));
  const rows = res.milestones;
  if (!rows.length) reasons.push("no milestone headings found");
  const bad = rows.filter((m) => !m.criteria.length || !(m.amount > 0)).map((m) => m.name);
  if (bad.length) reasons.push("milestones without amount or criteria: " + bad.join(", "));
  const total = milestonesTotal(rows);
  if (rows.length && Math.round(total) !== Math.round(goal)) {
    reasons.push(`milestones total ${usd(total)}, goal is ${usd(goal)}`);
  }
  const extra = (Object.keys(res.fields) as SectionKey[]).filter(
    (k) => !SECTIONS[type].includes(k),
  );
  if (extra.length) {
    reasons.push("sections of the other type: " + extra.map((k) => FIELDS[k].heading).join(", "));
  }
  if (res.unsorted) {
    reasons.push("unsorted text: " + res.unsorted.slice(0, 80).replace(/\n/g, " / "));
  }
  if (reasons.length) throw new Error("not structured: " + reasons.join("; "));
  const structured = normaliseStructured(
    { sections: res.fields, milestones: rows, links: res.page.links ?? "" },
    type,
  );
  if (structuredBytes(structured) > LIMITS.STRUCTURED_BYTES) throw new Error(TOO_LONG_MSG);
  structured.milestones.forEach((m, i) => {
    if (m.name.length > LIMITS.MILESTONE_NAME) {
      throw new Error(tooLong(`milestone ${letter(i)} name`, LIMITS.MILESTONE_NAME));
    }
    m.criteria.forEach((c, j) => {
      if (c.length > LIMITS.CRITERION_CHARS) throw new Error(criterionTooLong(letter(i), j));
    });
  });
  return structured;
}

/** Parse '---' frontmatter then the structured markdown body. Indented lines continue a value. */
export function parseRfpFile(text: string): ContentFields {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("missing '---' frontmatter block");
  const [, head, body] = m;
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line) && key) {
      fields[key] += (LINE_KEYS.has(key) ? "\n" : " ") + line.trim();
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
  // Never cut a file's text: a field past its cap is a sync error to fix in git.
  const summary = fields.summary ?? "";
  if (summary.length > MAX_SUMMARY) throw new Error(tooLong("summary", MAX_SUMMARY));
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
  // Page facts. `duration`, `topup` and `reviewer` match the Flask MVP's keys
  // (content/rfps/README.md); `recipient` and `recipient_url` are web-only.
  const [duration, durErr] = parseDuration(fields.duration ?? "");
  if (durErr) throw new Error(durErr);
  const topup = ["true", "yes", "1"].includes((fields.topup ?? "").trim().toLowerCase());
  if (topup && type !== "grant") throw new Error("topup applies to grants only");
  const recipientTeam = type === "grant" ? (fields.recipient ?? "").trim() : "";
  if (recipientTeam.length > LIMITS.RECIPIENT_CHARS) {
    throw new Error(tooLong("recipient", LIMITS.RECIPIENT_CHARS));
  }
  const milestoneReviewer = topup ? (fields.reviewer ?? "").trim() : "";
  if (milestoneReviewer.length > LIMITS.REVIEWER_CHARS) {
    throw new Error(tooLong("reviewer", LIMITS.REVIEWER_CHARS));
  }
  const [recipientUrl, urlErr] = validateHttpsLink(
    recipientTeam ? fields.recipient_url ?? "" : "",
  );
  if (urlErr) throw new Error(`recipient_url: ${urlErr}`);
  const structured = parseStructuredBody(body, type, goal!);
  return {
    title,
    summary,
    details: "",
    ...structured,
    goalUsd: goal!,
    discourseUrl: fields.forum ?? "",
    status,
    sortRank: pin ? Number(pin) : null,
    type,
    durationMonths: duration,
    recipientTeam,
    recipientUrl: recipientUrl!,
    topup,
    milestoneReviewer,
    backers: parseContentBackers(fields.backers ?? ""),
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
  /** Pledges added or changed from the files' `backers:` blocks. */
  backers: number;
  errors: string[];
}

/**
 * Pledges named in the file: added when missing, kept in step (amount, link,
 * spelling) when present, matched by organization name. Pledges the admin
 * added and the file does not name are left alone, and so is every status:
 * received and withdrawn are the admin's call. Returns how many rows changed.
 */
export async function syncBackers(
  db: Db,
  rfpId: string,
  backers: PastedBacker[],
  logos: LogoResolver = (name) => db.logos.get(name).then((l) => l?.cid ?? null),
) {
  if (!backers.length) return 0;
  let changed = 0;
  const have = await db.pledges.list(rfpId, true);
  for (const b of backers) {
    // A named logo must already be pinned (the sync script and the admin
    // dialog upload content/rfps/logos first); a line without one keeps whatever
    // logo the pledge has.
    let logoCid: string | undefined;
    if (b.logo) {
      const cid = await logos(b.logo);
      if (!cid) {
        throw new Error(
          `backers: ${b.org}: logo ${b.logo} is not uploaded yet (the sync uploads content/rfps/logos first)`,
        );
      }
      logoCid = cid;
    }
    const cur = have.find((p) => p.company.toLowerCase() === b.org.toLowerCase());
    if (!cur) {
      await db.pledges.add(rfpId, {
        company: b.org,
        amountUsd: b.amountUsd,
        status: "pledged",
        note: "",
        url: b.url,
        logoCid: logoCid ?? "",
      });
      changed++;
    } else if (
      cur.company !== b.org || cur.amountUsd !== b.amountUsd || cur.url !== b.url ||
      (logoCid !== undefined && cur.logoCid !== logoCid)
    ) {
      await db.pledges.update(rfpId, cur.id, {
        company: b.org,
        amountUsd: b.amountUsd,
        url: b.url,
        ...(logoCid !== undefined ? { logoCid } : {}),
      });
      changed++;
    }
  }
  return changed;
}

/** Upsert every file; bad files are reported and skipped, never blocking. */

export async function syncContent(
  db: Db,
  files: { name: string; text: string }[],
): Promise<SyncResult> {
  const out: SyncResult = { created: 0, updated: 0, backers: 0, errors: [] };
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!f.name.endsWith(".md") || f.name === "README.md") continue;
    const slug = slugFromFilename(f.name);
    if (!slug) {
      out.errors.push(`${f.name}: filename makes an empty slug`);
      continue;
    }
    try {
      const fields = parseRfpFile(f.text);
      const r = await db.rfps.upsertContent(slug, fields);
      if (r.action === "created") out.created++;
      else out.updated++;
      out.backers += await syncBackers(db, r.id, fields.backers);
    } catch (e) {
      out.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return out;
}
