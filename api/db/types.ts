export type RfpStatus = "pending" | "approved" | "rejected" | "archived";
export type RfpType = "rfp" | "grant";

export interface Rfp {
  id: string;
  slug: string;
  title: string;
  summary: string;
  details: string;
  discourseUrl: string;
  goalUsd: number;
  /** Private (admin-only): proposer contact. Never serialised publicly. */
  contact: string;
  /** Private (admin-only): fundraising leads. Never serialised publicly. */
  funders: string;
  status: RfpStatus;
  type: RfpType;
  sortRank: number | null;
  safeAddress: string;
  createdAt: number;
  approvedAt: number | null;
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
