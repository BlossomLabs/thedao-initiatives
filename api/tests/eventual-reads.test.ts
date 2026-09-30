/**
 * KV_EVENTUAL_READS=1 lets the public pages read from the nearest replica
 * (Deno KV "eventual" consistency); every write path keeps strong reads for
 * the entries it checks. Off by default.
 */
import { assert, assertEquals } from "@std/assert";
import { harness } from "./app-helpers.ts";

const seen: { op: string; consistency: string | undefined }[] = [];
let recording = false;
const realOpen = Deno.openKv;
Object.defineProperty(Deno, "openKv", {
  configurable: true,
  value: async (path?: string) => {
    const kv = await realOpen(path);
    return new Proxy(kv, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== "function") return v;
        if (prop === "get" || prop === "getMany" || prop === "list") {
          return (...a: unknown[]) => {
            if (recording) {
              const opts = a[1] as { consistency?: string } | undefined;
              seen.push({ op: String(prop), consistency: opts?.consistency });
            }
            return (v as (...x: unknown[]) => unknown).apply(target, a);
          };
        }
        return (v as (...x: unknown[]) => unknown).bind(target);
      },
    });
  },
});

async function record(run: () => Promise<Response>) {
  seen.length = 0;
  recording = true;
  const res = await run();
  recording = false;
  assertEquals(res.status, 200);
  return seen.map((s) => s.consistency);
}

Deno.test("eventual reads: public pages read eventually when enabled, writes stay strong", async () => {
  const h = await harness({ env: { KV_EVENTUAL_READS: "1" } });
  const r = await h.db.initiatives.insert({
    title: "Read me",
    summary: "s",
    status: "approved",
    goalUsd: 10,
    safeAddress: "0x0000000000000000000000000000000000000001",
  });
  await h.db.pledges.add(r.id, {
    company: "c",
    amountUsd: 5,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });

  // The index and the card summary are built (write paths, read strongly), as on a running site.
  await h.db.initiatives.cards("approved");
  await h.db.cards.summary(r.id);
  const board = await record(() => h.req("/api/board"));
  assert(board.length >= 4, `board did ${board.length} reads`);
  assert(board.every((c) => c === "eventual"), `board reads: ${board.join(",")}`);

  const page = await record(() => h.req(`/api/initiatives/${r.slug}`));
  assert(page.length >= 5, `page did ${page.length} reads`);
  assert(page.every((c) => c === "eventual"), `page reads: ${page.join(",")}`);

  // A write re-reads what it checks with strong consistency.
  seen.length = 0;
  recording = true;
  await h.db.initiatives.update(r.id, { goalUsd: 20 });
  recording = false;
  assert(seen.length >= 1);
  assert(seen.every((s) => s.consistency === undefined), "update used an eventual read");
  h.close();
});

Deno.test("eventual reads: off by default", async () => {
  const h = await harness();
  await h.db.initiatives.insert({
    title: "Read me",
    summary: "s",
    status: "approved",
    goalUsd: 10,
  });
  const board = await record(() => h.req("/api/board"));
  assert(board.length >= 1);
  assert(board.every((c) => c === undefined), `board reads: ${board.join(",")}`);
  h.close();
});

Deno.test("eventual reads: a card summary is built from strong reads and served from eventual ones", async () => {
  const h = await harness({ env: { KV_EVENTUAL_READS: "1" } });
  const r = await h.db.initiatives.insert({ title: "Summed", summary: "s", status: "approved" });
  await h.db.pledges.add(r.id, {
    company: "c",
    amountUsd: 5,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  // Cold: the version and summary lookup may be eventual; the rows it is built
  // from may not, or a replica behind the write would be frozen into the copy.
  seen.length = 0;
  recording = true;
  await h.db.cards.summary(r.id);
  recording = false;
  assertEquals(seen.map((s) => `${s.op}:${s.consistency}`), [
    "getMany:eventual",
    "list:undefined",
    "list:undefined",
  ]);
  // Warm: one eventual lookup.
  seen.length = 0;
  recording = true;
  await h.db.cards.summary(r.id);
  recording = false;
  assertEquals(seen.map((s) => `${s.op}:${s.consistency}`), ["getMany:eventual"]);
  h.close();
});
