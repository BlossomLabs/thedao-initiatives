/** Single source of truth for every KV key shape. */
export const K = {
  rfp: (id: string) => ["rfp", id] as const,
  rfpBySlug: (slug: string) => ["rfp_by_slug", slug] as const,
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
  rl: (bucket: string, windowStart: number) => ["rl", bucket, windowStart] as const,
  aiBudget: (day: string) => ["ai_budget", day] as const,
  safeSync: (rfpId: string) => ["safe_sync", rfpId] as const,
  lock: (name: string) => ["lock", name] as const,
  meta: (key: string) => ["meta", key] as const,
  termsAccept: (version: string, id: string) => ["terms_accept", version, id] as const,
  termsAcceptByAddr: (version: string, addr: string) =>
    ["terms_accept_addr", version, addr.toLowerCase()] as const,
};

export async function collect<T>(iter: Deno.KvListIterator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of iter) out.push(e.value);
  return out;
}
