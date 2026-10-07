import { collect, K, type ReadOptions } from "./keys.ts";
import type { Revision } from "./types.ts";

export const isLive = (r: Pick<Revision, "state">): boolean => (r.state ?? "live") === "live";

/** Read side of the revision history; revisions are written by initiativesRepo. */
export function revisionsRepo(kv: Deno.Kv, read: ReadOptions = undefined) {
  const get = async (rfpId: string, n: number): Promise<Revision | null> =>
    (await kv.get<Revision>(K.revision(rfpId, n), read)).value;

  /** Ascending by number: the published history. Archived ones, and the ones
   * that are not live (held, rejected, superseded), only on request. */
  const list = async (
    rfpId: string,
    includeArchived = false,
    includeUnpublished = false,
  ): Promise<Revision[]> => {
    const all = await collect(kv.list<Revision>({ prefix: K.revisions(rfpId) }, read));
    return all
      .filter((r) => (includeArchived || !r.archived) && (includeUnpublished || isLive(r)))
      .sort((a, b) => a.n - b.n);
  };

  async function setArchived(
    rfpId: string,
    n: number,
    archived: boolean,
  ): Promise<Revision | null> {
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Revision>(K.revision(rfpId, n));
      if (!cur.value) return null;
      const next = { ...cur.value, archived };
      const res = await kv.atomic().check(cur).set(K.revision(rfpId, n), next).commit();
      if (res.ok) return next;
    }
    throw new Error("update conflict");
  }

  return { get, list, setArchived };
}
