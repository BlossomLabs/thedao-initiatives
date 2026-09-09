import { collect, K } from "./keys.ts";
import type { Pledge, PledgeStatus } from "./types.ts";
import { newId } from "../lib/ids.ts";

export function pledgesRepo(kv: Deno.Kv, now: () => number) {
  async function add(
    rfpId: string,
    p: Omit<Pledge, "id" | "rfpId" | "createdAt">,
  ): Promise<Pledge> {
    const pledge: Pledge = { ...p, id: newId(), rfpId, createdAt: now() };
    await kv.set(K.pledge(rfpId, pledge.id), pledge);
    return pledge;
  }
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
    await kv.set(K.pledge(rfpId, id), { ...cur.value, status });
    return true;
  }
  const remove = (rfpId: string, id: string) => kv.delete(K.pledge(rfpId, id));
  async function totalActive(rfpId: string): Promise<number> {
    return (await list(rfpId)).reduce((s, p) => s + p.amountUsd, 0);
  }
  return { add, get, list, setStatus, remove, totalActive };
}
