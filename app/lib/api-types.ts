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
  /** 1 to 3 category slugs (app/lib/categories.ts), primary first; [] on untagged rows. */
  categories: string[];
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
  /** Open pledges only: not withdrawn, not received. */
  pledged: number;
  /** Pledges marked received; their money is already inside `donated`, not in `total`. */
  received: number;
  /** Safe balance value + paid out when `live`; the ledger's confirmed total otherwise. */
  donated: number;
  total: number;
  live: boolean;
  /** The saved Safe balance is due for a shared server refresh. */
  refreshDue?: boolean;
  /** Confirmed donation rows, for reconciliation. */
  ledger: number;
  paidOut: number;
}

/** Where the donations ledger stands (initiatives with a Safe). */
export interface LedgerStatus {
  /** Unix seconds of the last Safe sync run, null before the first. */
  checkedAt: number | null;
  ok: boolean;
  /** Cache lifetime in minutes; refreshes only run while a page is viewed. */
  intervalMinutes: number | null;
  refreshDue?: boolean;
  updating?: boolean;
}

/** A board card's initiative: identity, pitch and funding facts only. The
 * text and the page facts come with GET /api/initiatives/:slug. */
export type CardInitiative = Pick<
  Initiative,
  | "id"
  | "slug"
  | "title"
  | "summary"
  | "goalUsd"
  | "status"
  | "type"
  | "sortRank"
  | "safeAddress"
  | "categories"
  | "createdAt"
  | "approvedAt"
>;

export interface Card {
  initiative: CardInitiative;
  summary: Summary;
  pct: number;
  /** Open pledges plus the distinct addresses that donated. */
  backers: number;
  donations: number;
  ledger?: LedgerStatus | null;
  /** The "Pledged by" strip: up to four pledgers, `logoUrl` empty for one with no logo. */
  logos: { company: string; logoUrl: string; url: string }[];
  funded: boolean;
  donationsEnabled: boolean;
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

export interface BoardFlags {
  aiSearch: boolean;
  tokensOk: boolean;
  chainDetail: string;
  uploads: boolean;
  /** SUPPORT_URL is set: the floating Support button may show. */
  support: boolean;
  walletConnectProjectId: string;
  safeThreshold: number;
  safeOwnerCount: number;
}

export interface Board {
  /** The server's token verification needs a background refresh. */
  refreshDue?: boolean;
  cards: Card[];
  totals: { count: number; goal: number; raised: number; backers: number; donations: number };
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
  /** The server's token verification needs a background refresh. */
  refreshDue?: boolean;
  initiative: Initiative;
  /** Public history, oldest first (archived entries only for admins). */
  revisions: RevisionMeta[];
  summary: Summary;
  pct: number;
  pledges: Pledge[];
  donations: Donation[];
  funded: boolean;
  donationsEnabled: boolean;
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
  association?: import("../../shared/terms.ts").DonationAssociation;
  status: "confirmed" | "pending" | "failed" | "error";
  detail: string;
  amount: number;
  token: string;
  amountUsd: number;
}

export interface CommentsResponse {
  entries: CommentEntry[];
  /** From what needs no chain lookup; the badge's say comes with CommentExperts. */
  viewerCanVote: boolean;
  viewerRoles: string[];
}

/** What the ETHSecurity badge adds to a page of comments, asked apart from the list. */
export interface CommentExperts {
  /** Lowercase addresses of the commenters who hold the badge. */
  experts: string[];
  viewerCanVote: boolean;
}

export interface PostCommentResult {
  status: "published" | "held";
  id: string;
  claimToken: string;
  entry: CommentEntry | null;
}

export interface HeldMine {
  id: string;
  initiativeId: string;
  parentId: string | null;
  type: string;
  body: string;
  createdAt: number;
}

/** What the browser keeps of a session (the token itself is an HttpOnly cookie). */
export interface SessionInfo {
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
  /** The account keeps a watchlist (the browser list can be moved to it). */
  hasWatchlist?: boolean;
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
  refreshAfter?: number;
  updating?: boolean;
}

export interface AdminComment extends CommentEntry {
  initiativeId: string;
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
  safeApi: {
    configured: boolean;
    quota: { remaining: number; at: number } | null;
    refreshMinutes: number;
  };
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
    /** Where the calldata deploys to (CREATE2), and whether a Safe is already there (bound or not). */
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

/** The write freeze admins toggle from the dashboard (GET /api/admin/maintenance). */
export interface MaintenanceState {
  on: boolean;
  /** The admin who last changed it. */
  by: string;
  at: number;
  /** Shown to visitors in the banner. */
  note: string;
}

/** GET /api/board/settings: configuration the global UI needs without the board. */
export interface SiteSettings {
  uploads: boolean;
  support: boolean;
  maintenance?: Pick<MaintenanceState, "on" | "at" | "note">;
}

/** GET /api/admin/backup: every stored record, keys and values verbatim. */
export interface BackupFile {
  format: "thedao-kv-backup/1";
  exportedAt: string;
  prefixes: Record<string, number>;
  entries: { key: (string | number)[]; value: unknown }[];
}

/** POST /api/admin/restore. */
export interface RestoreResult {
  written: number;
  skipped: number;
  claimsRebuilt: number;
}
