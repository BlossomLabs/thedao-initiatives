import type { QueryClient } from "@tanstack/react-query";

export const DRAFT_PREFIX = "thedao:submit-draft";
const draftVersions = new Map<string, number>();
const draftFlushers = new Map<string, () => void>();
export const draftVersion = (key: string) => draftVersions.get(key) ?? 0;
export const cancelDraftWrites = (key: string) => draftVersions.set(key, draftVersion(key) + 1);
export const draftKey = (address: string) => `${DRAFT_PREFIX}:${address.toLowerCase()}`;

export function registerDraftFlusher(key: string, flush: () => void) {
  draftFlushers.set(key, flush);
  return () => {
    if (draftFlushers.get(key) === flush) draftFlushers.delete(key);
  };
}

/** Save the last keystrokes before opening logout confirmation or switching wallets. */
export function flushPrivateDrafts() {
  for (const flush of draftFlushers.values()) flush();
}

export function hasPrivateDraft(address: string): boolean {
  const owned = draftKey(address);
  try {
    return Object.keys(localStorage).some((key) =>
      (key === owned || key.startsWith(owned + ":")) && Boolean(localStorage.getItem(key))
    );
  } catch {
    return false;
  }
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
  ]);
  const filters = {
    predicate: (q: { queryKey: readonly unknown[] }) => roots.has(String(q.queryKey[0])),
  };
  void qc.cancelQueries(filters);
  qc.removeQueries(filters);
}

/** Delete only the selected wallet's draft, after the user chooses deletion. */
export function deletePrivateDraft(address: string) {
  const owned = draftKey(address);
  cancelDraftWrites(owned);
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = globalThis[name];
      for (const key of Object.keys(storage)) {
        if (key === owned || key.startsWith(owned + ":")) storage.removeItem(key);
      }
    } catch { /* Storage may be unavailable. */ }
  }
}

/** Copy before removal so an existing signed-in user's draft survives the storage migration. */
export function preserveLegacyDraft(address: string) {
  try {
    const legacy = localStorage.getItem(DRAFT_PREFIX);
    const key = draftKey(address);
    if (legacy) {
      // Preserve an older copy too if this wallet already has a newer scoped draft.
      let target = localStorage.getItem(key) ? `${key}:legacy` : key;
      const existing = localStorage.getItem(target);
      if (existing && existing !== legacy) target += `:${crypto.randomUUID()}`;
      localStorage.setItem(target, legacy);
      localStorage.removeItem(DRAFT_PREFIX);
      globalThis.dispatchEvent(new Event("draft-migrated"));
    }
  } catch { /* Leave the original intact if scoped storage is unavailable. */ }
}
