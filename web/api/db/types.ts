import type { Milestone, Sections } from "../../shared/draft/types.ts";

export type RfpStatus = "pending" | "approved" | "rejected" | "archived";
export type RfpType = "rfp" | "grant";

export interface Rfp {
  id: string;
  slug: string;
  /** Internal: a displaced proposal's permanent, non-reclaimable URL. */
  archiveSlug?: string;
  /** Internal, immutable Safe salt input. Missing on legacy rows: use slug. */
  safeDeploymentKey?: string;
  title: string;
  summary: string;
  details: string;
  discourseUrl: string;
  goalUsd: number;
  /** Private (admin-only): proposer contact. Never serialised publicly. */
  contact: string;
  /** Private (admin-only): fundraising leads. Never serialised publicly. */
  funders: string;
  /** SIWE address that submitted it, shown publicly ("" for imported rows). */
  proposer: string;
  status: RfpStatus;
  type: RfpType;
  sortRank: number | null;
  /** The donation Safe: assigned at approval as the CREATE2 address its deploy
   * will land on (counterfactual), so donations open before it is deployed. */
  safeAddress: string;
  /** The operational signers the address was computed from, frozen so the
   * deploy calldata still reaches it after a signer rotation. */
  safeSigners?: string[];
  /** Unix seconds when code was first seen at safeAddress; unset = not yet. */
  safeDeployedAt?: number;
  /** USD already paid out of the Safe to the team (admin-entered), so
   * "raised" = balance + paid out does not drop after a milestone payment.
   * Rows written before it lack the key; readers treat it as 0. */
  paidOutUsd?: number;
  /** Page facts (submission redesign, Sep 2026). Rows written before it lack
   * them; readers treat a missing value as the default. */
  /** Whole months from funding to the last milestone; null = not stated. */
  durationMonths: number | null;
  /** Grants only: the team the grant goes to, with an optional https link. */
  recipientTeam: string;
  recipientUrl: string;
  /** Grants only: work already under way with another funder. */
  topup: boolean;
  /** Top-ups only: who decides whether the remaining milestones pass. */
  milestoneReviewer: string;
  /** Structured body (submission redesign, Sep 2026): one answer per section
   * of the type, milestone rows, links. A structured row stores `details: ""`
   * (structured XOR details, enforced by `revise`). Rows written before it
   * lack the keys; readers treat them as `{}` / `[]`. */
  sections: Sections;
  milestones: Milestone[];
  links: string[];
  /** Number of the current (latest) revision; 0 = written before revisions existed. */
  revision: number;
  createdAt: number;
  approvedAt: number | null;
}

/** Who wrote a revision: the submit form, the proposer's edit page, the admin
 * editor, a content file, or the one-off import. */
export type RevisionSource = "submit" | "proposer" | "admin" | "content" | "import";

/** One version of the public text (title, summary, and either the legacy
 * `details` or the structured body). Immutable except `archived`. */
export interface Revision {
  rfpId: string;
  /** 1-based, dense, increasing. */
  n: number;
  title: string;
  summary: string;
  details: string;
  sections: Sections;
  milestones: Milestone[];
  links: string[];
  /** Wallet address; "" for content files and imports. */
  author: string;
  source: RevisionSource;
  /** Hidden from the public history (admins still see it). */
  archived: boolean;
  createdAt: number;
}

export type PledgeStatus = "pledged" | "received" | "withdrawn";

export interface Pledge {
  id: string;
  rfpId: string;
  company: string;
  amountUsd: number;
  status: PledgeStatus;
  note: string;
  url: string;
  logoCid: string;
  createdAt: number;
}

export type DonationStatus = "pending" | "confirmed" | "failed";

export interface Donation {
  rfpId: string;
  txHash: string;
  tokenSymbol: string;
  tokenAddress: string;
  amountRaw: string;
  /** USD value at confirmation time. */
  amountUsd: number;
  donor: string;
  status: DonationStatus;
  detail: string;
  source: "tx" | "safe-api";
  createdAt: number;
  confirmedAt: number | null;
}

export type CommentType = "suggestion" | "question" | "other";
export type CommentStatus = "published" | "held" | "discarded";

export interface Comment {
  id: string;
  rfpId: string;
  parentId: string | null;
  type: CommentType;
  topic: string;
  body: string;
  displayName: string;
  /** Private: only shown to admins. */
  email: string;
  address: string;
  roles: string[];
  status: CommentStatus;
  answered: boolean;
  reviewed: boolean;
  accepted: boolean;
  /** 0 = not featured, 1 = featured on the initiative, 2 = front page. */
  featured: number;
  featuredAt: number;
  votes: number;
  reports: number;
  aiSummary: string;
  claimToken: string;
  createdAt: number;
}

export interface Vote {
  value: 1 | -1;
  at: number;
}

export interface Profile {
  nickname: string;
  /** "" (default), "preset:N" or "ipfs:<cid>". */
  pfp: string;
  updatedAt: number;
}

export interface Session {
  address: string;
  isAdmin: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface SafeSyncState {
  at: number;
  lastTxHash: string;
  ok: boolean;
  error: string;
  /** History fully walked at least once. */
  backfilled: boolean;
  /** Where an incomplete walk (budget / page cap) continues next run. */
  resumeUrl: string;
}
