/** Hand-mirrored shapes of the API's JSON (api/lib/json.ts + routes). */
export type InitiativeType = "rfp" | "grant";
export type InitiativeStatus = "pending" | "approved" | "rejected" | "archived";

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
  safeAddress: string;
  createdAt: number;
  approvedAt: number | null;
}

export interface AdminInitiative extends Initiative {
  contact: string;
  funders: string;
}

export interface Summary {
  pledged: number;
  donated: number;
  total: number;
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
  summary: Summary;
  pct: number;
  pledges: Pledge[];
  donations: Donation[];
  funded: boolean;
  donationsEnabled: boolean;
  onramp: Onramp;
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
    alreadyDeployed: string | null;
  }
  | { enabled: false; reason: string };

export interface SafeConfirmResult {
  status: "ok" | "pending" | "error";
  address?: string;
  detail: string;
}
