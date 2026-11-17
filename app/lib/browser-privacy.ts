import { api } from "./api";
import type { SavedDraft } from "@shared/draft/autosave";
import type { QueryClient } from "@tanstack/react-query";

export const DRAFT_PREFIX = "thedao:submit-draft";
const draftVersions = new Map<string, number>();
const draftFlushers = new Map<string, () => Promise<void>>();
export const draftVersion = (key: string) => draftVersions.get(key) ?? 0;
export const cancelDraftWrites = (key: string) => draftVersions.set(key, draftVersion(key) + 1);
export const draftKey = (address: string) => `${DRAFT_PREFIX}:${address.toLowerCase()}`;

export function registerDraftFlusher(key: string, flush: () => Promise<void>) {
  draftFlushers.set(key, flush);
  return () => {
    if (draftFlushers.get(key) === flush) draftFlushers.delete(key);
  };
}

/** Save the last keystrokes before opening logout confirmation or switching wallets. */
export async function flushPrivateDrafts() {
  await Promise.all([...draftFlushers.values()].map((flush) => flush()));
}
export const draftPath = (address: string) =>
  `/api/draft/${encodeURIComponent(address.toLowerCase())}`;
export const readPrivateDraft = (address: string) =>
  api<SavedDraft>(draftPath(address), { passive: true, signal: AbortSignal.timeout(15_000) });
export async function hasPrivateDraft(address: string): Promise<boolean> {
  return Boolean((await readPrivateDraft(address)).data);
}
export function cancelPrivateDrafts() {
  for (const key of draftFlushers.keys()) cancelDraftWrites(key);
}
let cacheGeneration = 0;
export const privateCacheGeneration = () => cacheGeneration;

/** ASVS-12: erase credentials' cached data before another viewer can observe it. */
export function clearPrivateQueries(qc: QueryClient) {
  cacheGeneration++;
  const roots = new Set([
    "admin",
    "mine",
    "initiative",
    "revision",
    "sessions",
    "comments",
    "comments-mine",
    "watchlist",
  ]);
  const filters = {
    predicate: (q: { queryKey: readonly unknown[] }) =>
      roots.has(String(q.queryKey[0])) &&
      // An initiative's page read signed out (["initiative", slug, null]) went without the
      // cookie: it is the public page, kept so a sign-in on it doesn't blank it (#82).
      !(q.queryKey[0] === "initiative" && q.queryKey.length === 3 && q.queryKey[2] === null),
  };
  void qc.cancelQueries(filters);
  qc.removeQueries(filters);
}

/** A tombstone prevents already queued writes from resurrecting a deleted draft. */
export async function deletePrivateDraft(address: string) {
  cancelDraftWrites(draftKey(address));
  const current = await readPrivateDraft(address);
  return await api<SavedDraft>(draftPath(address), {
    method: "DELETE",
    json: { version: current.version },
    signal: AbortSignal.timeout(15_000),
  });
}
