/** The per-initiative funding summary (#46): a rebuildable copy of what the board needs from the pledge and donation rows. */
import { assertEquals } from "@std/assert";
import { harness } from "./app-helpers.ts";
import { K } from "../db/keys.ts";
import { exportBackup, restoreBackup } from "../services/backup.ts";
import type { Verification } from "../chain/verify.ts";

const pledge = (amountUsd: number, logoCid = "") => ({
  company: "Acme",
  amountUsd,
  status: "pledged" as const,
  note: "",
  url: "https://acme.example",
  logoCid,
});
const confirmed = (amountUsd: number, donor: string): Verification => ({
  found: true,
  pending: false,
  ok: true,
  tokenSymbol: "USDC",
  tokenAddress: "0x",
  amountRaw: "1",
  amount: 1,
  amountUsd,
  donor,
  detail: "",
});

Deno.test("card summary: built from the rows once, reused until a pledge or donation write", async () => {
  const h = await harness();
  const r = await h.db.initiatives.insert({
    title: "S",
    summary: "s",
    status: "approved",
    goalUsd: 100,
  });
  const p = await h.db.pledges.add(r.id, pledge(40, "cid1"));
  const s = await h.db.cards.summary(r.id);
  assertEquals(s.pledges.map((x) => [x.company, x.amountUsd, x.status, x.logoCid, x.url]), [
    ["Acme", 40, "pledged", "cid1", "https://acme.example"],
  ]);
  assertEquals([s.donations, s.donatedUsd, s.donors], [0, 0, 0]);
  // The stored copy is what is read until a write says otherwise.
  await h.kv.set(K.cardSummary(r.id), { ...s, donors: 99 });
  assertEquals((await h.db.cards.summary(r.id)).donors, 99);
  await h.db.pledges.update(r.id, p.id, { amountUsd: 50 });
  assertEquals((await h.db.cards.summary(r.id)).pledges[0].amountUsd, 50);
  await h.db.pledges.setStatus(r.id, p.id, "received");
  assertEquals((await h.db.cards.summary(r.id)).pledges[0].status, "received");
  await h.db.pledges.setStatus(r.id, p.id, "withdrawn");
  assertEquals((await h.db.cards.summary(r.id)).pledges, []);
  await h.db.pledges.add(r.id, pledge(10));
  await h.db.pledges.remove(r.id, p.id);
  assertEquals((await h.db.cards.summary(r.id)).pledges.length, 1);
  await h.db.donations.record(r.id, "0xA1", confirmed(5, "0xDonor"));
  await h.db.donations.record(r.id, "0xA2", confirmed(7, "0xdonor"));
  await h.db.donations.record(r.id, "0xA3", {
    ...confirmed(9, "0xOther"),
    ok: false,
    pending: true,
  });
  const d = await h.db.cards.summary(r.id);
  assertEquals([d.donations, d.donatedUsd, d.donors], [2, 12, 1]);
  h.close();
});

Deno.test("card summary: a copy built from rows older than the last write is not reused", async () => {
  const h = await harness();
  const r = await h.db.initiatives.insert({
    title: "S",
    summary: "s",
    status: "approved",
    goalUsd: 100,
  });
  await h.db.pledges.add(r.id, pledge(40));
  const s = await h.db.cards.summary(r.id);
  await h.kv.set(K.cardSummary(r.id), { ...s, version: "from before the write", donors: 99 });
  assertEquals((await h.db.cards.summary(r.id)).donors, 0);
  h.close();
});

Deno.test("card summary: many at once, in the order asked, misses built alongside hits", async () => {
  const h = await harness();
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await h.db.initiatives.insert({
      title: `S${i}`,
      summary: "s",
      status: "approved",
      goalUsd: 100,
    });
    await h.db.pledges.add(r.id, pledge(i + 1));
    ids.push(r.id);
  }
  await h.db.cards.summary(ids[3]);
  const all = await h.db.cards.summaries(ids);
  assertEquals(all.map((s) => s.pledges[0].amountUsd), ids.map((_, i) => i + 1));
  h.close();
});

Deno.test("card summary: a restore drops every copy, since it writes the rows without a version", async () => {
  const h = await harness();
  const r = await h.db.initiatives.insert({
    title: "S",
    summary: "s",
    status: "approved",
    goalUsd: 100,
  });
  await h.db.pledges.add(r.id, pledge(40));
  const file = await exportBackup(h.db, h.deps.now);
  await h.db.cards.summary(r.id);
  await restoreBackup(h.db, file, "replace", h.deps.now);
  assertEquals((await h.kv.get(K.cardSummary(r.id))).value, null);
  h.close();
});
