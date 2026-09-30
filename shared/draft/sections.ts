import type { DraftType, PageKey, SectionKey } from "./types.ts";

export interface FieldDef {
  heading: string;
  q: string;
  helper: string;
  rows: number;
  grantOnly?: true;
}

/** One question per section. The site owns the heading; the submitter answers
 * the question. Order is the order on the page, and it differs by type. */
export const FIELDS: Record<SectionKey, FieldDef> = {
  why: {
    heading: "Why this matters",
    rows: 7,
    q: "What gap does this close, and what can people do afterwards that they cannot today?",
    helper: "1 to 2 short paragraphs or a bullet list.",
  },
  in_scope: {
    heading: "In scope",
    rows: 8,
    q: "What gets built or delivered?",
    helper: "Concrete deliverables. This is also where you say what the money actually pays for.",
  },
  out_scope: {
    heading: "Out of scope",
    rows: 5,
    q: "What is deliberately not included?",
    helper: "This is where the expensive misunderstandings get prevented.",
  },
  existing: {
    heading: "Existing work",
    rows: 4,
    q: "What prior art should bidders build on?",
    helper:
      "Links. Say what would justify building on something else. Write none if there is nothing.",
  },
  who: {
    heading: "Who we expect to do this",
    rows: 7,
    q: "What does a winning team look like, and who co-drafted this initiative?",
    helper:
      "Nobody is pre-selected. Name co-authors and your own relationship to any team or codebase named above.",
  },
  hard_req: {
    heading: "Hard requirements",
    rows: 9,
    q: "What must every proposal meet or be ignored?",
    helper:
      "Numbered. Verifiable acceptance, a maintenance plan, plus what the domain demands. Open source is welcome, not required: state the license you expect.",
  },
  team: {
    heading: "The team",
    rows: 6,
    grantOnly: true,
    q: "Who does the work? Names, roles, track record, links.",
    helper:
      "Also state any other funding you have for this work, and your relationships to codebases or firms named in this initiative.",
  },
  why_grant: {
    heading: "Why a grant: what already exists",
    rows: 7,
    grantOnly: true,
    q: "What have you already built or done that gives you a decisive head start, and where can a stranger check it?",
    helper:
      "Links to code, reports, deployments. Say why the price is below a from-scratch build. If the head start is thin, say so, the admin may ask you to resubmit as an RFP.",
  },
  commitments: {
    heading: "Commitments",
    rows: 6,
    grantOnly: true,
    q: "What do you commit to on license, maintenance after the money is spent, and pinned targets? Any exception you are asking for?",
    helper:
      "What you commit to on license, maintenance after the money is spent, and pinned targets. State any exception you are asking for.",
  },
};

export const SECTIONS: Record<DraftType, SectionKey[]> = {
  rfp: ["why", "in_scope", "out_scope", "existing", "who", "hard_req"],
  grant: ["why", "team", "why_grant", "in_scope", "out_scope", "commitments"],
};

/** Every section key, both types, in page order for RFPs then the grant-only ones. */
export const SECTION_KEYS = Object.keys(FIELDS) as SectionKey[];

export const PAGE_KEYS: PageKey[] = [
  "title",
  "summary",
  "categories",
  "goal",
  "duration",
  "recipient",
  "backers",
  "links",
  "funders",
  "contact",
];

export type AliasTarget = SectionKey | PageKey | "milestones";

/** Heading aliases: the contract with the guide (public/submit.md). Change the guide
 * when you change this. */
export const ALIASES: Record<string, AliasTarget> = {
  "title": "title",
  "short summary": "summary",
  "summary": "summary",
  "categories": "categories",
  "category": "categories",
  "tags": "categories",
  "funding goal": "goal",
  "funding goal (usd)": "goal",
  "budget": "goal",
  "funding": "goal",
  "expected duration": "duration",
  "expected duration (months)": "duration",
  "duration": "duration",
  "indicative duration": "duration",
  "recipient team": "recipient",
  "backers": "backers",
  "backers already committed": "backers",
  "already committed": "backers",
  "already committed (usd)": "backers",
  "links": "links",
  "link": "links",
  "who is likely to fund this": "funders",
  "who is likely to fund this?": "funders",
  "funders": "funders",
  "contact": "contact",
  "why this matters": "why",
  "in scope": "in_scope",
  "scope": "in_scope",
  "out of scope": "out_scope",
  "existing work": "existing",
  "prior art": "existing",
  "who we expect to do this": "who",
  "who we expect to do this work": "who",
  "hard requirements": "hard_req",
  "requirements": "hard_req",
  "the team": "team",
  "team": "team",
  "why a grant": "why_grant",
  "why a grant what already exists": "why_grant",
  "why a grant: what already exists": "why_grant",
  "commitments": "commitments",
  "milestones": "milestones",
  "milestones (draft)": "milestones",
  "draft milestones": "milestones",
  "milestone plan": "milestones",
  // the 2026-09 board format folded these into In scope (a second section
  // for the same key is appended under its old heading in bold)
  "what this actually pays for": "in_scope",
  "what this rfp actually pays for": "in_scope",
  "what this grant actually pays for": "in_scope",
  "what this pays for": "in_scope",
};

export const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function headingKey(raw: string, type: DraftType): AliasTarget | null {
  let n = String(raw).replace(/[*_`#]/g, "").toLowerCase();
  n = n.replace(/\s+/g, " ").trim().replace(/[:.]+$/, "");
  if (n === "what already exists") return type === "grant" ? "why_grant" : "existing";
  if (n === "the recipient" || n === "recipient team and why them") {
    return type === "grant" ? "team" : "who";
  }
  return ALIASES[n] ?? null;
}

/** No heading is allowed inside a field: a '### Foo' line becomes '**Foo**'. */
export function stripInlineHeadings(text: string): string {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const h = HEADING_RE.exec(line);
      return h ? `**${h[2].trim()}**` : line;
    })
    .join("\n")
    .trim();
}

export const letter = (i: number): string => String.fromCharCode(65 + (i % 26));
