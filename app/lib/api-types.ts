/** Hand-mirrored shapes of the API's JSON (api/lib/json.ts + routes). */
import type { VoteManifest } from "../../shared/vote/manifest";
import type { AddBlocker } from "../../shared/vote/add-plan";
import type { Finding, Findings, Milestone, SectionKey, Sections } from "@shared/draft/types";
import type { VoteSettings, VoteState } from "@shared/vote";

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
  /** An edit to the approved text is waiting for the team. */
  editInReview: boolean;
  /** The team's note when the latest edit was turned down; null otherwise. */
  editRejected: { n: number; note: string; at: number } | null;
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
  /** Omitted unless the proposer or a recently authenticated administrator. */
  contact?: string;
  funders?: string;
  /** The proposer's edit waiting for the team, if any: same answers only. */
  pendingRevision?: number | null;
}

export type RevisionSource = "submit" | "proposer" | "admin" | "content" | "import";
/** Only `live` revisions are public; the rest are for the proposer and the admins. */
export type RevisionState = "live" | "pending" | "rejected" | "superseded";

/** One entry of an initiative's history, without the text. */
export interface RevisionMeta {
  n: number;
  /** Wallet address; "" for content files and imports. */
  author: string;
  source: RevisionSource;
  /** Only ever true in admin responses. */
  archived: boolean;
  state: RevisionState;
  /** The admin who accepted or rejected a proposer's edit, and when. */
  reviewedBy?: string;
  reviewedAt?: number;
  /** The admin's reason for rejecting it. */
  note?: string;
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
  /** This version's categories; null on one written before they were recorded. */
  categories: string[] | null;
  /** The funding goal this edit sets; null when it leaves the goal alone. */
  goalUsd: number | null;
}

/** The text fields a revision may change. */
export type RevisionText = Pick<
  Revision,
  "title" | "summary" | "details" | "sections" | "milestones" | "links"
>;

export interface AdminInitiative extends Initiative {
  /** The proposer's edit waiting for an admin, if any (approved initiatives). */
  pendingRevision: number | null;
  /** Related projects share an affiliation (the vote's ballot rules). Grants only. */
  affiliations?: string[];
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
  | "recipientTeam"
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
  /** Where it stands for TheDAO's vote; only while the vote display is on. "closed": past the
   * deadline to qualify and not on the ballot, so Open for funding only. */
  vote?: VoteState["kind"] | "ballot" | "closed";
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
  /** Jev can search automatically after typing pauses. */
  aiSearchAuto?: boolean;
  tokensOk: boolean;
  chainDetail: string;
  uploads: boolean;
  /** SUPPORT_URL is set: the floating Support button may show. */
  support: boolean;
  walletConnectProjectId: string;
  safeThreshold: number;
  safeOwnerCount: number;
  /** Vote eligibility: the floor tick and its line show only while `show` is on. */
  vote: VoteSettings;
  /** The round the site runs (null: none), and the whole of it once the real vote has
   * opened (its results replace the board). Older boards in a cache may lack it. */
  round?: {
    kind: "test" | "real";
    chainId: number;
    contract: string;
    opensAt: number;
    closesAt: number;
    manifest?: VoteManifest;
  } | null;
}

export interface Sponsor {
  company: string;
  logoUrl: string;
  url: string;
  totalUsd: number;
}

export interface Board {
  /** The server's token verification needs a background refresh. */
  refreshDue?: boolean;
  cards: Card[];
  /** Top pledgers across the published initiatives (at most eight). */
  sponsors?: Sponsor[];
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

/** A goal change on a ballot initiative waiting for a round admin to sign it (#149). */
export interface GoalRequestJson {
  goalUsd: number;
  /** Who asked: for the team and the proposer only. */
  by?: string;
  at: number;
}

export interface InitiativePage {
  /** The server's token verification needs a background refresh. */
  refreshDue?: boolean;
  initiative: Initiative;
  /** Public history, oldest first (archived entries only for admins). */
  revisions: RevisionMeta[];
  summary: Summary;
  /** On the production ballot (#149): its goal waits for a round admin; its type and
   * affiliations change only with the round. */
  onBallot?: boolean;
  goalRequest?: GoalRequestJson;
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
  /** Holds the ETHSecurity Badge (the check behind the EXPERT role in comments). */
  isBadgeHolder?: boolean;
  expiresAt: number;
  nickname: string | null;
  pfp: string;
  pfpUrl: string;
  /** The account keeps a watchlist (the browser list can be moved to it). */
  hasWatchlist?: boolean;
}

export interface Profile {
  nickname: string | null;
  /** "private-badge" fixes the shared avatar ahead of uploaded pictures and ENS. */
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
  /** What the AI screen said; null on rows from before it and fast-lane posts. */
  aiScreen: AiScreen | null;
  initiative: { slug: string; title: string } | null;
}

export interface AiScreen {
  verdict: "constructive" | "unclear" | "spam" | null;
  nameFlag: string | null;
  /** Why it was held ("" when published). */
  reason: string;
  /** Why the screen gave no answer ("" when it answered). */
  error: string;
  at: number;
}

type InitiativeRef = { slug: string; title: string };

/** What the board knows about the wallet behind a held comment. */
export interface HeldAuthor {
  address: string;
  admin: boolean;
  proposerOf: (InitiativeRef & { status: InitiativeStatus; here: boolean })[];
  backed: (InitiativeRef & { usd: number; here: boolean })[];
  /** null: the badge lookup failed. */
  badge: boolean | null;
  /** Every comment from this wallet, this one included. */
  comments: { published: number; held: number; discarded: number };
  firstSeen: number;
}

export interface HeldComment extends AdminComment {
  context: {
    parent: {
      id: string;
      body: string;
      displayName: string;
      address: string;
      status: "published" | "held" | "discarded";
    } | null;
    /** null: posted with a name only, no wallet. */
    author: HeldAuthor | null;
  };
}

/** A to-do row: the card plus the proposer's edit waiting for an admin, if any. */
export type AdminTodoRow = CardInitiative & { pendingRevision: number | null };

/** GET /api/admin/todo: the dashboard's first paint, KV only. */
export interface AdminTodo {
  /** Pending submissions, oldest first. */
  submissions: AdminTodoRow[];
  /** Approved initiatives with a proposer edit waiting. */
  edits: AdminTodoRow[];
  held: AdminComment[];
  unanswered: AdminComment[];
  reported: AdminComment[];
  weekAgo: number;
  /** Every initiative, for the "Open an initiative" search. */
  index: Pick<CardInitiative, "id" | "slug" | "title" | "status" | "type">[];
  counts: { total: number; approved: number; approvedThisWeek: number };
}

/** GET /api/admin/status: snapshots of the services, never a live chain call. */
export interface AdminStatus {
  chain: { detail: string; checkedAt: number };
  safeApi: {
    configured: boolean;
    quota: { remaining: number; at: number } | null;
    refreshMinutes: number;
  };
  signers: { ok: boolean; detail: string; list: string[]; threshold: number };
}

/** A row of GET /api/admin/initiatives, the full table loaded on demand. */
export interface AdminListRow {
  initiative: AdminInitiative;
  summary: Summary;
  safeSync: SafeSyncState | null;
}

export interface PendingPledge {
  pid: string;
  kind: "add" | "edit" | "remove";
  /** A new pledge's company and amount (an edit or removal shows on its own row). */
  company: string | null;
  amountUsd: number | null;
  hash: string | null;
}

/** A pledge change held until a round admin signs it (Awaiting signature). */
export interface AwaitingPledgeJson {
  pid: string;
  kind: "add" | "edit" | "remove";
  company: string;
  /** What the pledge counts on-chain after the change (a received or withdrawn one: 0);
   * null for a remove. */
  amountUsd: number | null;
  /** What it counts on-chain now, per its row; null for an add. */
  fromUsd: number | null;
  /** Its status after the change; null for a remove. */
  status: "pledged" | "received" | "withdrawn" | null;
  /** The asking admin's address. */
  by: string;
  /** Unix seconds. */
  at: number;
  /** Why its last signed send failed, and when (unix seconds). */
  lastError: string | null;
  lastErrorAt: number | null;
}

/** Waiting for a round admin (api/services/round-admin-queue.ts): an approved initiative
 * Qualified for the vote and not in the round. */
export interface ReadyJson {
  id: string;
  slug: string;
  title: string;
  goalUsd: number;
  raisedUsd: number;
  safeAddress: string;
  type: "rfp" | "grant";
  affiliations: string[];
  /** Its open pledges, signed once it is on the ballot. */
  pledges: { pid: string; company: string; amountUsd: number }[];
  blocker: AddBlocker | null;
  /** The round admin putting it on the ballot right now, since when (unix seconds). */
  claim: { by: string; at: number } | null;
}
/** A pledge of an initiative in the round that waits for a round admin's signature. */
export interface ToSignJson {
  rfpId: string;
  slug: string;
  title: string;
  pid: string;
  company: string;
  kind: "add" | "edit" | "remove" | "record";
  /** What the pledge counts on-chain after the change (0 for a remove, a received or a
   * withdrawn pledge). */
  amountUsd: number;
  /** What it counts on-chain now, per its row (an add: null); for a "record", the chain's
   * (null: none there). */
  fromUsd: number | null;
  /** Its status after the change; null for a remove. */
  status: "pledged" | "received" | "withdrawn" | null;
  /** Who asked, and when (unix seconds): an awaiting request's; null otherwise. */
  by: string | null;
  at: number | null;
  /** Why the request's last signed send failed, and when (unix seconds); null otherwise. */
  lastError: string | null;
  lastErrorAt: number | null;
  /** A change already relayed and not settled yet. */
  inFlight: { hash: `0x${string}` | null } | null;
}
/** GET /api/admin/vote-round/queue (and /vote-test-round/queue). */
/** A ballot initiative's goal for a round admin to put on the round (#149): its goal
 * request, or (`record`) a site goal the round doesn't have. */
export interface GoalToSignJson {
  kind: "request" | "record";
  rfpId: string;
  slug: string;
  title: string;
  /** The goal the round has now, and the one to set (dollars). */
  fromUsd: number;
  toUsd: number;
  by: string | null;
  at: number | null;
  /** `setInitiative`'s arguments, numbers as decimal strings. */
  call: { id: string; account: `0x${string}`; goalUsd: string; rfp: boolean; groups: string };
  /** The same call as Safe Transaction Builder JSON. */
  batch: unknown;
  /** The round's configuration revision the call was built at (null: a round without it). */
  configRevision: string | null;
  /** Why it can't be signed now; null when it can. */
  blocked?:
    | { kind: "settled"; tier: "S" | "A" | "B" }
    | { kind: "withdrawn" }
    | { kind: "settling"; until: number | null }
    | { kind: "unknown" }
    | null;
}

export interface RoundAdminQueueJson {
  kind: "real" | "test";
  ready: ReadyJson[];
  toSign: ToSignJson[];
  goals?: GoalToSignJson[];
}

export interface AdminInitiativePage {
  initiative: AdminInitiative;
  revisions: RevisionMeta[];
  summary: Summary;
  pledges: Pledge[];
  /** During the real vote: pledge changes sent on-chain whose transaction hasn't settled. */
  pendingPledges?: PendingPledge[];
  /** During the real vote: pledge changes held until a round admin signs them. */
  awaitingPledges: AwaitingPledgeJson[];
  /** The real vote has closed: awaiting pledges can't be signed any more, only saved as
   * they are or discarded. */
  awaitingClosed?: boolean;
  /** On the production ballot (#149). */
  onBallot?: boolean;
  goalRequest?: GoalRequestJson;
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

/** Today's AI calls against the daily caps (GET /api/admin/ai-budget). */
export interface AiBudgetState {
  /** The UTC day the counters belong to, "2026-11-24". */
  day: string;
  used: number;
  cap: number;
  supportUsed: number;
  supportCap: number;
}

/** GET /api/board/settings: configuration the global UI needs without the board. */
export interface SiteSettings {
  uploads: boolean;
  support: boolean;
  maintenance?: Pick<MaintenanceState, "on" | "at" | "note">;
  vote?: VoteSettings;
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
