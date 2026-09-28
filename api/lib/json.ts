/**
 * The ONE place that turns stored records into API JSON. `contact`, `funders`
 * and comment `email` are private and only leave through the admin shapes.
 */
import type { Comment, Donation, Initiative, Pledge, Revision } from "../db/types.ts";
import { LIVE_ROLES, ROLE_ORDER } from "../services/roles.ts";
import type { Config } from "../config.ts";
import { isStructured } from "../../shared/draft/mod.ts";
import { pickText } from "../db/initiatives.ts";
import { categoriesOf } from "../../shared/categories.ts";

export function ipfsUrl(config: Config, cid: string): string {
  return cid ? `https://${config.pinataGateway}/ipfs/${cid}` : "";
}

export function pfpUrl(config: Config, pfp: string): string {
  return pfp.startsWith("ipfs:") ? ipfsUrl(config, pfp.slice(5)) : "";
}

export function publicInitiative(r: Initiative) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    details: r.details,
    discourseUrl: r.discourseUrl,
    goalUsd: r.goalUsd,
    status: r.status,
    type: r.type,
    sortRank: r.sortRank,
    safeAddress: r.safeAddress,
    paidOutUsd: r.paidOutUsd ?? 0,
    proposer: r.proposer ?? "",
    durationMonths: r.durationMonths ?? null,
    recipientTeam: r.recipientTeam ?? "",
    recipientUrl: r.recipientUrl ?? "",
    topup: Boolean(r.topup),
    milestoneReviewer: r.milestoneReviewer ?? "",
    categories: categoriesOf(r),
    ...structuredJson(r),
    revision: r.revision ?? 0,
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
  };
}

/** What a board card needs: identity, the one-line pitch and the funding
 * facts. The text (details, sections, milestones, links) and the page facts
 * stay on the initiative page, which the board never renders. */
export function cardInitiative(r: Initiative) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    goalUsd: r.goalUsd,
    status: r.status,
    type: r.type,
    sortRank: r.sortRank,
    safeAddress: r.safeAddress,
    categories: categoriesOf(r),
    /** Grants only; the board's keyword filter searches it. */
    recipientTeam: r.type === "grant" ? r.recipientTeam ?? "" : "",
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
  };
}

/** The admin dashboard row: the card plus the contact it shows. */
export function adminCardInitiative(r: Initiative) {
  return { ...cardInitiative(r), contact: r.contact };
}

/** The structured body with defaults for rows written before it existed. */
function structuredJson(r: Pick<Initiative, "sections" | "milestones" | "links">) {
  const t = pickText({ ...r, title: "", summary: "", details: "" });
  return {
    sections: t.sections,
    milestones: t.milestones,
    links: t.links,
    structured: isStructured(t),
  };
}

/** History entry: who wrote it and when, without the text. */
export function revisionMeta(v: Revision) {
  return {
    n: v.n,
    author: v.author,
    source: v.source,
    archived: v.archived,
    createdAt: v.createdAt,
  };
}

export function revisionJson(v: Revision) {
  return {
    ...revisionMeta(v),
    title: v.title,
    summary: v.summary,
    details: v.details,
    ...structuredJson(v),
  };
}

export function adminInitiative(r: Initiative) {
  return { ...publicInitiative(r), contact: r.contact, funders: r.funders };
}

/** What the proposer sees of their own row: the public shape plus the two
 * private fields they wrote themselves. */
export const proposerInitiative = adminInitiative;

export function pledgeJson(config: Config, p: Pledge) {
  return {
    id: p.id,
    company: p.company,
    amountUsd: p.amountUsd,
    status: p.status,
    note: p.note,
    url: p.url,
    logoUrl: ipfsUrl(config, p.logoCid),
    createdAt: p.createdAt,
  };
}

/** Token quantity from the raw on-chain amount. */
export function tokenQty(
  d: Donation,
  decimalsOf: (sym: string) => number | undefined,
): number {
  const dec = d.tokenSymbol === "ETH" ? 18 : decimalsOf(d.tokenSymbol);
  if (dec === undefined) return d.amountUsd;
  try {
    return Number(BigInt(d.amountRaw)) / 10 ** dec;
  } catch {
    return d.amountUsd;
  }
}

export function donationJson(
  d: Donation,
  decimalsOf: (sym: string) => number | undefined,
) {
  return {
    txHash: d.txHash,
    tokenSymbol: d.tokenSymbol,
    tokenAddress: d.tokenAddress,
    amount: tokenQty(d, decimalsOf),
    amountRaw: d.amountRaw,
    amountUsd: d.amountUsd,
    donor: d.donor,
    status: d.status,
    detail: d.detail,
    source: d.source,
    createdAt: d.createdAt,
    confirmedAt: d.confirmedAt,
  };
}

export type CommentJson = Record<string, unknown>;

/**
 * `live` holds the roles decided at view time (team, proposer, badge); they
 * replace any such tag an older comment still carries. The two that rank
 * highest in ROLE_ORDER go out.
 */
export function commentJson(
  c: Comment,
  live: string[] = [],
  myVotes?: Record<string, number>,
  replies?: CommentJson[],
): CommentJson {
  const out: CommentJson = {
    id: c.id,
    type: c.type,
    topic: c.topic,
    body: c.body,
    displayName: c.displayName,
    address: c.address,
    roles: [...live, ...c.roles.filter((r) => !LIVE_ROLES.has(r))]
      .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)).slice(0, 2),
    answered: c.answered,
    reviewed: c.reviewed,
    accepted: c.accepted,
    featured: c.featured,
    featuredAt: c.featuredAt,
    votes: c.votes,
    createdAt: c.createdAt,
  };
  if (myVotes) out.myvote = myVotes[c.id] ?? 0;
  if (replies) out.replies = replies;
  return out;
}

export function adminCommentJson(
  c: Comment,
  live: string[],
  initiative?: { slug: string; title: string } | null,
) {
  return {
    ...commentJson(c, live),
    initiativeId: c.rfpId,
    parentId: c.parentId,
    status: c.status,
    email: c.email,
    reports: c.reports,
    aiSummary: c.aiSummary,
    initiative: initiative ? { slug: initiative.slug, title: initiative.title } : null,
  };
}
