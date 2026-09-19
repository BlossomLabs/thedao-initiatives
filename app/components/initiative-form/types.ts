/**
 * The form's draft: what the proposer types, before any parsing. Amounts stay
 * strings while typing; toPayload (useDraft.ts) turns them into numbers.
 * Milestones, criteria and backers carry a client-only id so rows keep their
 * identity while they move; the letters are derived from the index.
 */
import type {
  BackerInput,
  CheckScope,
  DraftType,
  Milestone,
  SectionKey,
  Sections,
} from "@shared/draft/mod";

export type FormMode = "submit" | "edit";

export interface DraftCriterion {
  id: string;
  text: string;
}

export interface DraftMilestone {
  id: string;
  name: string;
  /** As typed ("50,000"); parseAmount reads it. */
  amount: string;
  adoption: boolean;
  done: boolean;
  link: string;
  /** "YYYY-MM" or "". */
  month: string;
  criteria: DraftCriterion[];
}

export interface DraftBacker {
  id: string;
  org: string;
  amount: string;
  url: string;
  /** The chosen logo file; uploaded on submit, never autosaved. */
  logo: File | null;
  /** Receipt of an upload that already happened (a retry skips the upload). */
  logoCid: string;
}

export interface DraftPage {
  title: string;
  summary: string;
  goal: string;
  /** Whole months as typed. */
  duration: string;
  recipientTeam: string;
  recipientUrl: string;
  discourseUrl: string;
  /** One link per line. */
  links: string;
}

export interface Draft {
  type: DraftType;
  topup: boolean;
  milestoneReviewer: string;
  page: DraftPage;
  sections: Sections;
  milestones: DraftMilestone[];
  backers: DraftBacker[];
  priv: { funders: string; contact: string };
  /** Pasted lines that matched no section. Kept for the proposer, never posted. */
  unsorted: string;
}

/** POST /api/initiatives body (and the text part of an edit). */
export interface SubmitPayload {
  website: "";
  type: DraftType;
  topup: boolean;
  title: string;
  summary: string;
  discourseUrl: string;
  goal: string;
  durationMonths: string;
  recipientTeam: string;
  recipientUrl: string;
  milestoneReviewer: string;
  funders: string;
  contact: string;
  sections: Partial<Record<SectionKey, string>>;
  milestones: Milestone[];
  links: string[];
  backers: BackerInput[];
}

export interface FormOptions {
  mode: FormMode;
  scope: CheckScope;
}
