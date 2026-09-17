/**
 * Readers for the structured body and the backer list of a submission or an
 * edit. They normalise the raw JSON with the shared rules module and report
 * the hard caps as findings (the same shape the form paints), so a route can
 * merge them with `checkSubmission` and fail once with every problem listed.
 */
import {
  type BackerInput,
  criterionTooLong,
  type DraftType,
  FIELDS,
  type Finding,
  type Findings,
  isHttpsUrl,
  letter,
  LIMITS,
  normaliseStructured,
  parseAmount,
  SECTION_KEYS,
  SECTIONS,
  type Structured,
  structuredBytes,
  TOO_LONG_MSG,
  tooLong,
} from "../../shared/draft/mod.ts";
import { HttpError } from "./errors.ts";
import { assertFields } from "./body.ts";

export const TEXT_FIELDS = ["title", "summary", "sections", "milestones", "links"] as const;

export const FINDINGS_MSG = "Please fix the problems marked on the form.";
export const LOGO_CID_RE = /^[A-Za-z0-9]{40,100}$/;

const empty = (): Findings => ({ errors: [], warnings: [] });

/** The byte-cap finding for a body, or null when it fits one KV value. */
export function byteCapFinding(s: Structured): Finding | null {
  return structuredBytes(s) > LIMITS.STRUCTURED_BYTES
    ? { field: "", msg: TOO_LONG_MSG, kind: "cap" }
    : null;
}

/**
 * `sections`, `milestones` and `links` from a JSON body, normalised for the
 * type (other-type keys dropped, headings stripped, empties removed) with
 * the caps reported as findings. The messages match `checkSubmission` so a
 * merged list never says the same thing twice.
 */
export function readStructured(
  body: Record<string, unknown>,
  type: DraftType,
): { structured: Structured; findings: Findings } {
  if (body.sections && typeof body.sections === "object") {
    assertFields(body.sections, SECTION_KEYS, "sections.");
  }
  if (Array.isArray(body.milestones)) {
    body.milestones.forEach((row, i) => {
      if (row && typeof row === "object") {
        assertFields(
          row,
          ["name", "amount", "adoption", "done", "link", "month", "criteria"],
          `milestones[${i}].`,
        );
      }
    });
  }
  const structured = normaliseStructured(body, type);
  const f = empty();
  const err = (field: string, msg: string) => f.errors.push({ field, msg, kind: "cap" });
  for (const key of SECTIONS[type]) {
    if ((structured.sections[key] ?? "").length > LIMITS.SECTION_CHARS) {
      err(key, tooLong(FIELDS[key].heading, LIMITS.SECTION_CHARS));
    }
  }
  if (structured.milestones.length > LIMITS.MILESTONES) {
    err("milestones", `At most ${LIMITS.MILESTONES} milestones.`);
  }
  structured.milestones.forEach((m, i) => {
    if (m.criteria.length > LIMITS.CRITERIA_PER_MILESTONE) {
      err(
        `ms_${i}_crit`,
        `Milestone ${letter(i)}: at most ${LIMITS.CRITERIA_PER_MILESTONE} criteria.`,
      );
    }
    m.criteria.forEach((c, j) => {
      if (c.length > LIMITS.CRITERION_CHARS) {
        err(`ms_${i}_c${j}`, criterionTooLong(letter(i), j));
      }
    });
  });
  if (structured.links.length > LIMITS.LINKS) err("links", `At most ${LIMITS.LINKS} links.`);
  const cap = byteCapFinding(structured);
  if (cap) f.errors.push(cap);
  return { structured, findings: f };
}

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/**
 * The backers declared on the form: `{org, amountUsd, url, logoCid}[]`. Rows
 * keep their index (the findings point at form rows); the route skips the
 * ones without an organisation when it writes pledges.
 */
export function readBackers(
  body: Record<string, unknown>,
): { backers: BackerInput[]; findings: Findings } {
  const f = empty();
  const err = (field: string, msg: string, kind: Finding["kind"] = "content") =>
    f.errors.push({ field, msg, kind });
  const raw = Array.isArray(body.backers) ? body.backers : [];
  raw.forEach((row, i) => {
    if (row && typeof row === "object") {
      assertFields(
        row,
        ["org", "company", "amountUsd", "amount", "url", "logoCid"],
        `backers[${i}].`,
      );
    }
  });
  const backers: BackerInput[] = [];
  raw.slice(0, LIMITS.BACKERS + 1).forEach((r, i) => {
    const b = r && typeof r === "object" ? r as Record<string, unknown> : {};
    const org = clip(b.org ?? b.company, LIMITS.BACKER_ORG + 1);
    if (org.length > LIMITS.BACKER_ORG) {
      err(
        `bk_org_${i}`,
        tooLong(`Backer ${i + 1}: the organization name`, LIMITS.BACKER_ORG),
        "cap",
      );
    }
    const url = clip(b.url, LIMITS.BACKER_URL + 1);
    const logoCid = clip(b.logoCid, LIMITS.LOGO_CID + 1);
    const who = org || "Backer " + (i + 1);
    if (url.length > LIMITS.BACKER_URL) {
      err(`bk_url_${i}`, tooLong(`${who}: the link`, LIMITS.BACKER_URL), "cap");
    } else if (url && !isHttpsUrl(url)) {
      err(`bk_url_${i}`, `${who}: the link must be an https URL.`);
    }
    if (logoCid && !LOGO_CID_RE.test(logoCid)) err(`bk_logo_${i}`, "Upload the logo again.");
    backers.push({
      org,
      amountUsd: Math.round(parseAmount(b.amountUsd ?? b.amount) * 100) / 100,
      url: isHttpsUrl(url) ? url : "",
      logoCid: LOGO_CID_RE.test(logoCid) ? logoCid : "",
    });
  });
  if (raw.length > LIMITS.BACKERS) err("backers", `At most ${LIMITS.BACKERS} backers.`, "cap");
  return { backers, findings: f };
}

/** Concatenate findings, dropping exact repeats (same field and message). */
export function mergeFindings(...lists: Findings[]): Findings {
  const out = empty();
  const seen = new Set<string>();
  for (const l of lists) {
    for (const kind of ["errors", "warnings"] as const) {
      for (const x of l[kind]) {
        const k = kind + "\n" + x.field + "\n" + x.msg;
        if (seen.has(k)) continue;
        seen.add(k);
        out[kind].push(x);
      }
    }
  }
  return out;
}

/** 400 with `{error, findings}` when there is at least one error. */
export function assertNoErrors(findings: Findings, msg = FINDINGS_MSG): void {
  if (findings.errors.length) throw new HttpError(400, msg, { findings });
}
