/** Single source of truth for every KV key shape. */
export const K = {
  rfp: (id: string) => ["rfp", id] as const,
  rfpBySlug: (slug: string) => ["rfp_by_slug", slug] as const,
  rfpBySourceSlug: (slug: string) => ["rfp_by_source_slug", slug] as const,
  reusedRfpSlug: (slug: string) => ["reused_rfp_slug", slug] as const,
  rfpBySafe: (addr: string) => ["rfp_by_safe", addr.toLowerCase()] as const,
  revision: (rfpId: string, n: number) => ["revision", rfpId, n] as const,
  revisions: (rfpId: string) => ["revision", rfpId] as const,
  pledge: (rfpId: string, id: string) => ["pledge", rfpId, id] as const,
  pledges: (rfpId: string) => ["pledge", rfpId] as const,
  donation: (rfpId: string, tx: string) => ["donation", rfpId, tx.toLowerCase()] as const,
  donations: (rfpId: string) => ["donation", rfpId] as const,
  donationByTx: (tx: string, rfpId: string) => ["donation_by_tx", tx.toLowerCase(), rfpId] as const,
  donationsByTx: (tx: string) => ["donation_by_tx", tx.toLowerCase()] as const,
  comment: (rfpId: string, id: string) => ["comment", rfpId, id] as const,
  comments: (rfpId: string) => ["comment", rfpId] as const,
  commentRef: (id: string) => ["comment_ref", id] as const,
  claim: (token: string) => ["claim", token] as const,
  vote: (commentId: string, addr: string) => ["vote", commentId, addr.toLowerCase()] as const,
  votes: (commentId: string) => ["vote", commentId] as const,
  profile: (addr: string) => ["profile", addr.toLowerCase()] as const,
  nick: (nick: string) => ["nick", nick.toLowerCase()] as const,
  nonce: (nonce: string) => ["nonce", nonce] as const,
  session: (tokenHash: string) => ["session", tokenHash] as const,
  sessionsByAddr: (addr: string, tokenHash: string) =>
    ["sessions_by_addr", addr.toLowerCase(), tokenHash] as const,
  sessionsOf: (addr: string) => ["sessions_by_addr", addr.toLowerCase()] as const,
  sessionRevocation: (addr: string) => ["session_revocation", addr.toLowerCase()] as const,
  globalSessionRevocation: ["session_revocation_global"] as const,
  rl: (bucket: string, windowStart: number) => ["rl", bucket, windowStart] as const,
  /** Receipt of a logo upload: who pinned this CID (expires after a day). */
  upload: (cid: string) => ["upload", cid] as const,
  contentLogo: (name: string) => ["content_logo", name] as const,
  aiBudget: (day: string) => ["ai_budget", day] as const,
  safeSync: (rfpId: string) => ["safe_sync", rfpId] as const,
  safeBalances: (safe: string) => ["safe_balances", safe.toLowerCase()] as const,
  lock: (name: string) => ["lock", name] as const,
  meta: (key: string) => ["meta", key] as const,
  /** One immutable donation-terms acceptance per donation, keyed by its tx hash. */
  termsAcceptance: (txHash: string) => ["terms_accept", txHash.toLowerCase()] as const,
};

export async function collect<T>(iter: Deno.KvListIterator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of iter) out.push(e.value);
  return out;
}
