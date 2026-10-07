import { collect, K, type ReadOptions } from "./keys.ts";
import type { Pledge, PledgeStatus } from "./types.ts";
import { newId } from "../lib/ids.ts";

export function pledgesRepo(kv: Deno.Kv, now: () => number, read: ReadOptions = undefined) {
  /** Every write also bumps the initiative's card version (db/cards.ts). */
  const write = (rfpId: string) => kv.atomic().set(K.cardVersion(rfpId), crypto.randomUUID());
  async function add(
    rfpId: string,
    p: Omit<Pledge, "id" | "rfpId" | "createdAt">,
  ): Promise<Pledge> {
    const pledge: Pledge = { ...p, id: newId(), rfpId, createdAt: now() };
    await write(rfpId).set(K.pledge(rfpId, pledge.id), pledge).commit();
    return pledge;
  }
  const get = async (rfpId: string, id: string) =>
    (await kv.get<Pledge>(K.pledge(rfpId, id))).value;
  /** `strong` for a copy built from the rows (db/cards.ts): never from a replica behind a write. */
  async function list(rfpId: string, includeWithdrawn = false, strong = false): Promise<Pledge[]> {
    const all = await collect(
      kv.list<Pledge>({ prefix: K.pledges(rfpId) }, strong ? undefined : read),
    );
    return all.filter((p) => includeWithdrawn || p.status !== "withdrawn")
      .sort((a, b) => b.amountUsd - a.amountUsd);
  }
  async function setStatus(
    rfpId: string,
    id: string,
    status: PledgeStatus,
  ): Promise<boolean> {
    const cur = await kv.get<Pledge>(K.pledge(rfpId, id));
    if (!cur.value) return false;
    await write(rfpId).set(K.pledge(rfpId, id), { ...cur.value, status }).commit();
    return true;
  }
  /** Patch the words and the amount; status has its own setter. */
  async function update(
    rfpId: string,
    id: string,
    patch: Partial<Pick<Pledge, "company" | "amountUsd" | "url" | "note" | "logoCid">>,
  ): Promise<Pledge | null> {
    const cur = await kv.get<Pledge>(K.pledge(rfpId, id));
    if (!cur.value) return null;
    const next = { ...cur.value, ...patch };
    await write(rfpId).set(K.pledge(rfpId, id), next).commit();
    return next;
  }
  const remove = async (rfpId: string, id: string) => {
    await write(rfpId).delete(K.pledge(rfpId, id)).commit();
  };
  /** Still owed: a received pledge has been paid, and counts as a donation instead. */
  async function totalActive(rfpId: string): Promise<number> {
    return (await list(rfpId)).filter((p) => p.status === "pledged")
      .reduce((s, p) => s + p.amountUsd, 0);
  }
  return { add, get, list, setStatus, update, remove, totalActive };
}
