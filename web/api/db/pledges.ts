import { collect, K } from "./keys.ts";
import type { Pledge, PledgeStatus } from "./types.ts";
import { newId } from "../lib/ids.ts";

export function pledgesRepo(kv: Deno.Kv, now: () => number) {
  async function add(
    rfpId: string,
    p: Omit<Pledge, "id" | "rfpId" | "createdAt">,
  ): Promise<Pledge> {
    const pledge: Pledge = { ...p, id: newId(), rfpId, createdAt: now() };
    await write(rfpId, pledge.id, pledge);
    return pledge;
  }
  /** Every pledge write also bumps the initiative's funding version (live pages watch it). */
  const write = (rfpId: string, id: string, value: Pledge | null) => {
    const op = kv.atomic();
    if (value) op.set(K.pledge(rfpId, id), value);
    else op.delete(K.pledge(rfpId, id));
    return op.sum(K.fundingVersion(rfpId), 1n).commit();
  };
  const get = async (rfpId: string, id: string) =>
    (await kv.get<Pledge>(K.pledge(rfpId, id))).value;
  async function list(rfpId: string, includeWithdrawn = false): Promise<Pledge[]> {
    const all = await collect(kv.list<Pledge>({ prefix: K.pledges(rfpId) }));
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
    await write(rfpId, id, { ...cur.value, status });
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
    await write(rfpId, id, next);
    return next;
  }
  const remove = (rfpId: string, id: string) => write(rfpId, id, null).then(() => {});
  async function totalActive(rfpId: string): Promise<number> {
    return (await list(rfpId)).reduce((s, p) => s + p.amountUsd, 0);
  }
  return { add, get, list, setStatus, update, remove, totalActive };
}
