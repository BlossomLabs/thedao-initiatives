/** The per-status card index (#47): what the board and the daily refresh read instead of every row. */
import { assertEquals } from "@std/assert";
import { harness } from "./app-helpers.ts";
import { cardRow } from "../db/initiatives.ts";
import { K } from "../db/keys.ts";
import { exportBackup, restoreBackup } from "../services/backup.ts";
import type { InitiativeStatus } from "../db/types.ts";

type H = Awaited<ReturnType<typeof harness>>;
const STATUSES: InitiativeStatus[] = ["pending", "approved", "rejected", "archived"];
const scanned = async (h: H, s: InitiativeStatus) =>
  (await h.db.initiatives.list([s])).map(cardRow);
const indexed = (h: H, s: InitiativeStatus) => h.db.initiatives.cards(s);
async function sameAsScan(h: H, when: string) {
  for (const s of STATUSES) assertEquals(await indexed(h, s), await scanned(h, s), `${when}: ${s}`);
}

Deno.test("status index: cards(status) equals a full scan after every kind of write", async () => {
  const h = await harness();
  const a = await h.db.initiatives.insert({
    title: "A",
    summary: "a",
    status: "approved",
    goalUsd: 10,
  });
  const b = await h.db.initiatives.insert({
    title: "B",
    summary: "b",
    status: "pending",
    goalUsd: 20,
  });
  await sameAsScan(h, "insert");
  await h.db.initiatives.update(a.id, { goalUsd: 15, sortRank: 1, categories: ["opsec"] });
  await sameAsScan(h, "field patch");
  await h.db.initiatives.update(b.id, { status: "approved", approvedAt: h.clock.now });
  await sameAsScan(h, "status move");
  await h.db.initiatives.revise(a.id, { title: "A renamed", summary: "a2", details: "" }, {
    author: "",
    source: "admin",
  });
  await sameAsScan(h, "revise");
  await h.db.initiatives.update(a.id, { status: "archived" });
  await sameAsScan(h, "archive");
  await h.db.initiatives.unarchive(a.id);
  await sameAsScan(h, "unarchive");
  await h.db.initiatives.update(a.id, { status: "archived" });
  // A new submission reclaims the archived slug: the old row moves to an archive slug.
  const c = await h.db.initiatives.insert({ title: "A", summary: "c" }, undefined, undefined, {
    reclaimArchivedSlug: true,
  });
  assertEquals(c.slug, "a");
  await sameAsScan(h, "reclaim");
  await h.db.initiatives.upsertContent("a-file", {
    title: "From a file",
    summary: "f",
    details: "",
    goalUsd: 30,
    discourseUrl: "",
    status: "approved",
    sortRank: null,
    type: "rfp",
    durationMonths: null,
    recipientTeam: "",
    recipientUrl: "",
    topup: false,
    milestoneReviewer: "",
  });
  await sameAsScan(h, "content upsert");
  h.close();
});

Deno.test("status index: rows from before the index are indexed on the first read, then the index is the source", async () => {
  const h = await harness();
  const r = await h.db.initiatives.insert({
    title: "Old",
    summary: "o",
    status: "approved",
    goalUsd: 10,
  });
  // As a database written before the index existed: no entry, no built mark.
  await h.kv.delete(K.initiativeByStatus("approved", r.id));
  await h.kv.delete(K.meta("rfp_by_status"));
  assertEquals((await indexed(h, "approved")).map((x) => x.id), [r.id]);
  // A row that slips past the repo is not on the board: the index, not the scan, is read.
  await h.kv.set(K.initiative("raw"), { ...r, id: "raw", slug: "raw" });
  assertEquals((await indexed(h, "approved")).map((x) => x.id), [r.id]);
  assertEquals((await scanned(h, "approved")).length, 2);
  h.close();
});

Deno.test("status index: a restore drops the built mark so the index is rebuilt from the restored rows", async () => {
  const h = await harness();
  const r = await h.db.initiatives.insert({
    title: "Kept",
    summary: "k",
    status: "approved",
    goalUsd: 10,
  });
  await indexed(h, "approved");
  const file = await exportBackup(h.db, h.deps.now);
  // The live database moved on since the file was taken.
  await h.db.initiatives.update(r.id, { status: "archived" });
  await restoreBackup(h.db, file, "replace", h.deps.now);
  assertEquals((await h.kv.get(K.meta("rfp_by_status"))).value, null);
  assertEquals((await indexed(h, "approved")).map((x) => x.id), [r.id]);
  assertEquals(await indexed(h, "archived"), []);
  h.close();
});

Deno.test("status index: cards carry the grant's recipient team; an index from before it is rebuilt", async () => {
  const h = await harness({ env: { BOARD_CACHE_SECS: "0" } });
  const grant = await h.db.initiatives.insert({
    title: "A grant",
    summary: "g",
    status: "approved",
    goalUsd: 10,
    type: "grant",
    recipientTeam: "Trail of Bits",
  });
  await h.db.initiatives.insert({
    title: "An RFP",
    summary: "r",
    status: "approved",
    goalUsd: 10,
    type: "rfp",
    recipientTeam: "ignored for an rfp",
  });
  // An index built before the team was a card field: its entries lack it, its mark is 1.
  await h.db.initiatives.cards("approved");
  const { recipientTeam: _, ...old } = (await h.kv.get<Record<string, unknown>>(
    K.initiativeByStatus("approved", grant.id),
  )).value!;
  await h.kv.set(K.initiativeByStatus("approved", grant.id), old);
  await h.kv.set(K.meta("rfp_by_status"), 1);

  const board = await (await h.req("/api/board")).json() as {
    cards: { initiative: { title: string; recipientTeam: string } }[];
  };
  const team = (t: string) => board.cards.find((c) => c.initiative.title === t)!.initiative;
  assertEquals(team("A grant").recipientTeam, "Trail of Bits");
  assertEquals(team("An RFP").recipientTeam, "");
  h.close();
});
