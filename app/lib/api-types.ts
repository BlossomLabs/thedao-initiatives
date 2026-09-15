/** Hand-mirrored shapes of the API's JSON (api/lib/json.ts + routes). */
import type { Finding, Findings, Milestone, SectionKey, Sections } from "@shared/draft/types";

export type { Finding, Findings, Milestone, SectionKey, Sections };
export type InitiativeType = "rfp" | "grant";
export type InitiativeStatus = "pending" | "approved" | "rejected" | "archived";

/** One row of GET /api/initiatives/mine. */
export interface MineItem {
  slug: string;
  title: string;
  type: InitiativeType;
  status: InitiativeStatus;
  goalUsd: number;
  createdAt: number;
}

export interface Initiative {
  id: string;
  slug: string;
  title: string;
  summary: string;
  details: string;
  discourseUrl: string;
  goalUsd: number;
  status: InitiativeStatus;
  type: InitiativeType;
  sortRank: number | null;
  /** The donation Safe, "" until it is deployed and verified (approval needs it). */
  safeAddress: string;
  paidOutUsd: number;
  /** Wallet that submitted it ("" for imported initiatives). */
  proposer: string;
  /** Whole months from funding to the last milestone; null = not stated. */
  durationMonths: number | null;
  /** Grants only: the team the grant goes to, with an optional https link. */
  recipientTeam: string;
  recipientUrl: string;
  /** Grants only: work already under way with another funder. */
  topup: boolean;
  /** Top-ups only: who decides whether the remaining milestones pass. */
  milestoneReviewer: string;
  /** Structured body (sections per type, milestones, links). A structured
   * row has `details === ""`; a legacy row has empty sections. */
  sections: Sections;
  milestones: Milestone[];
  links: string[];
  structured: boolean;
  /** Current revision number; 0 for rows that predate revisions. */
  revision: number;
  createdAt: number;
  approvedAt: number | null;
  /** The private fields: only in answers to the proposer or an admin. */
  contact?: string;
  funders?: string;
}

export type RevisionSource = "submit" | "proposer" | "admin" | "content" | "import";

/** One entry of an initiative's history, without the text. */
export interface RevisionMeta {
  n: number;
  /** Wallet address; "" for content files and imports. */
  author: string;
  source: RevisionSource;
  /** Only ever true in admin responses. */
  archived: boolean;
  createdAt: number;
}

export interface Revision extends RevisionMeta {
  title: string;
  summary: string;
  details: string;
  sections: Sections;
  milestones: Milestone[];
  links: string[];
  structured: boolean;
}

/** The fields a revision may change. */
export type RevisionText = Pick<
  Revision,
  "title" | "summary" | "details" | "sections" | "milestones" | "links"
>;

export interface AdminInitiative extends Initiative {
  contact: string;
  funders: string;
}

export interface Summary {
  pledged: number;
  /** Safe balance value + paid out when `live`; the ledger's confirmed total otherwise. */
  donated: number;
  total: number;
  live: boolean;
  /** Confirmed donation rows, for reconciliation. */
  ledger: number;
  paidOut: number;
}

/** Where the donations ledger stands (initiatives with a Safe). */
export interface LedgerStatus {
  /** Unix seconds of the last Safe sync run, null before the first. */
  checkedAt: number | null;
  ok: boolean;
  /** Minutes between runs, null when the cron shape is unusual. */
  intervalMinutes: number | null;
}

export interface Onramp {
  url: string;
  prefilled: boolean;
}

export interface Card {
  initiative: Initiative;
  summary: Summary;
  pct: number;
  backers: number;
  donations: number;
  logos: { company: string; logoUrl: string }[];
  funded: boolean;
  donationsEnabled: boolean;
  onramp?: Onramp;
}

export interface CommentEntry {
  id: string;
  type: "suggestion" | "question" | "other";
  topic: string;
  body: string;
  displayName: string;
  address: string;
  roles: string[];
  answered: boolean;
  reviewed: boolean;
  accepted: boolean;
  featured: number;
  featuredAt: number;
  votes: number;
  createdAt: number;
  myvote?: number;
  replies?: CommentEntry[];
}

export interface CommunityEntry extends CommentEntry {
  initiative: { slug: string; title: string };
}

export interface BoardFlags {
  aiSearch: boolean;
  tokensOk: boolean;
  chainDetail: string;
  uploads: boolean;
  /** SUPPORT_URL is set: the floating Support button may show. */
  support: boolean;
  onramp: boolean;
  walletConnectProjectId: string;
  safeThreshold: number;
  safeOwnerCount: number;
}

export interface Board {
  cards: Card[];
  totals: { count: number; goal: number; raised: number; backers: number; donations: number };
  community: CommunityEntry[];
  flags: BoardFlags;
}

export interface Pledge {
  id: string;
  company: string;
  amountUsd: number;
  status: "pledged" | "received" | "withdrawn";
  note: string;
  url: string;
  logoUrl: string;
  createdAt: number;
}

export interface Donation {
  txHash: string;
  tokenSymbol: string;
  tokenAddress: string;
  amount: number;
  amountRaw: string;
  amountUsd: number;
  donor: string;
  status: "pending" | "confirmed" | "failed";
  detail: string;
  source: "tx" | "safe-api";
  createdAt: number;
  confirmedAt: number | null;
}

export interface InitiativePage {
  initiative: Initiative;
  /** Public history, oldest first (archived entries only for admins). */
  revisions: RevisionMeta[];
  summary: Summary;
  pct: number;
  pledges: Pledge[];
  donations: Donation[];
  funded: boolean;
  donationsEnabled: boolean;
  onramp: Onramp;
  ledger: LedgerStatus | null;
}

export type DonateParams =
  | {
    enabled: true;
    chainId: number;
    tokens: Record<string, { address: string; decimals: number }>;
    rates: Record<string, number>;
    minTokenUnits: number;
    minEth: number;
  }
  | { enabled: false; reason: string };

export interface FunderLead {
  id: string;
  title: string;
  slug: string;
  type: InitiativeType;
  status: string;
  goalUsd: number;
  funders: string;
  contact: string;
  createdAt: number;
}

export interface DonateResult {
  status: "confirmed" | "pending" | "failed" | "error";
  detail: string;
  amount: number;
  token: string;
  amountUsd: number;
}

export interface CommentsResponse {
  entries: CommentEntry[];
  viewerCanVote: boolean;
  viewerRoles: string[];
}

export interface PostCommentResult {
  status: "published" | "held";
  id: string;
  claimToken: string;
  entry: CommentEntry | null;
}

export interface HeldMine {
  id: string;
  rfpId: string;
  parentId: string | null;
  type: string;
  body: string;
  createdAt: number;
}

export interface SessionInfo {
  token: string;
  address: string;
  isAdmin: boolean;
  expiresAt: number;
}

export interface Me {
  address: string;
  isAdmin: boolean;
  expiresAt: number;
  nickname: string | null;
  pfp: string;
  pfpUrl: string;
}

export interface Profile {
  nickname: string | null;
  pfp: string;
  pfpUrl: string;
}

/** ENS primary name and avatar record of an address (null when unset). */
export interface EnsName {
  name: string | null;
  avatar: string | null;
}

export interface SafeSyncState {
  at: number;
  lastTxHash: string;
  ok: boolean;
  error: string;
  backfilled: boolean;
  resumeUrl: string;
}

export interface AdminComment extends CommentEntry {
  rfpId: string;
  parentId: string | null;
  status: "published" | "held" | "discarded";
  email: string;
  reports: number;
  aiSummary: string;
  initiative: { slug: string; title: string } | null;
}

export interface AdminDashboard {
  rows: { initiative: AdminInitiative; summary: Summary; safeSync: SafeSyncState | null }[];
  pendingCount: number;
  chain: { detail: string; checkedAt: number };
  held: AdminComment[];
  unanswered: AdminComment[];
  reported: AdminComment[];
  weekAgo: number;
  bell: number;
  safeApi: { configured: boolean; quota: { remaining: number; at: number } | null; cron: string };
  signers: { ok: boolean; detail: string; list: string[]; threshold: number };
}

export interface AdminInitiativePage {
  initiative: AdminInitiative;
  revisions: RevisionMeta[];
  summary: Summary;
  pledges: Pledge[];
  donations: Donation[];
  safeSync: SafeSyncState | null;
  signers: { ok: boolean; detail: string; list: string[]; threshold: number };
}

export type SafeDeployParams =
  | {
    enabled: true;
    chainId: number;
    factory: string;
    calldata: string;
    signers: string[];
    threshold: number;
    /** Where the calldata deploys to (CREATE2), and whether that Safe is already bound. */
    address: string;
    deployed: boolean;
  }
  | { enabled: false; reason: string };

export interface SafeConfirmResult {
  status: "ok" | "pending" | "error";
  address?: string;
  detail: string;
}

/** GET/POST/DELETE /api/admin/admins */
export interface AdminList {
  admins: { address: string; fixed: boolean }[];
  /** The caller's own address (it cannot remove itself). */
  you: string;
}
