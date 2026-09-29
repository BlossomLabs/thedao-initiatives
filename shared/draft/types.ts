/**
 * Structured initiatives (submission redesign, Sep 2026): one question per
 * section, milestone rows, links. These shapes are shared by the API and the
 * React app; the rules in the sibling files run on both sides.
 */
export type DraftType = "rfp" | "grant";

export type SectionKey =
  | "why"
  | "in_scope"
  | "out_scope"
  | "existing"
  | "who"
  | "hard_req"
  | "team"
  | "why_grant"
  | "commitments";

export type PageKey =
  | "title"
  | "summary"
  | "categories"
  | "goal"
  | "duration"
  | "recipient"
  | "backers"
  | "links"
  | "funders"
  | "contact";

export interface Milestone {
  name: string;
  amount: number;
  adoption: boolean;
  done: boolean;
  /** https URL of the delivered work, or "". */
  link: string;
  /** "YYYY-MM" target month, or "". */
  month: string;
  criteria: string[];
}

export interface BackerInput {
  org: string;
  amountUsd: number;
  url: string;
  logoCid: string;
}

export type Sections = Partial<Record<SectionKey, string>>;

export interface Structured {
  sections: Sections;
  milestones: Milestone[];
  links: string[];
}

export type FindingKind = "missing" | "content" | "cap";

export interface Finding {
  /** Form field id: title, summary, goal, duration_months, recipient_team,
   * recipient_url, links, links_<i>, funders, contact, milestone_reviewer, a
   * section key, milestones, ms_<i>_name|amount|crit|link|month|c<j>,
   * backers, bk_org_<i>|bk_amount_<i>|bk_url_<i>|bk_logo_<i>, or "" for a
   * global message. */
  field: string;
  msg: string;
  /** "missing": the answer is empty (the form hides these until the first
   * submit attempt); "content": what is there is wrong; "cap": past a hard
   * limit, which blocks every writer, the admin editor included. Warnings
   * omit it. */
  kind?: FindingKind;
}

export interface Findings {
  errors: Finding[];
  warnings: Finding[];
}

export interface SplitResult {
  page: Partial<Record<PageKey, string>>;
  fields: Sections;
  milestones: Milestone[];
  unsorted: string;
}
