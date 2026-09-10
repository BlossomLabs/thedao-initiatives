import { assert, assertEquals } from "@std/assert";
import { prefixedKv } from "../db/prefix.ts";
import { createDb } from "../db/mod.ts";
import { K } from "../db/keys.ts";

Deno.test("prefixedKv: empty prefix returns the bare handle", async () => {
  const kv = await Deno.openKv(":memory:");
  assert(prefixedKv(kv, "") === kv);
  kv.close();
});

Deno.test("prefixedKv: two prefixes on one database never collide", async () => {
  const kv = await Deno.openKv(":memory:");
  const a = prefixedKv(kv, "a");
  const b = prefixedKv(kv, "b");
  await a.set(["rfp", "1"], "A");
  await b.set(["rfp", "1"], "B");

  assertEquals((await a.get(["rfp", "1"])).value, "A");
  assertEquals((await b.get(["rfp", "1"])).value, "B");
  // stored under the prefix, invisible to the bare handle at the bare key
  assertEquals((await kv.get(["rfp", "1"])).value, null);
  assertEquals((await kv.get(["a", "rfp", "1"])).value, "A");

  // list: only own rows, keys come back without the prefix
  const seen: Deno.KvKey[] = [];
  for await (const e of a.list({ prefix: ["rfp"] })) seen.push(e.key);
  assertEquals(seen, [["rfp", "1"]]);
  const many = await a.getMany([["rfp", "1"], ["rfp", "2"]]);
  assertEquals(many.map((e) => [e.key, e.value]), [[["rfp", "1"], "A"], [["rfp", "2"], null]]);

  // atomic: a `check(entry)` round-trips through the stripped key
  const cur = await a.get(["rfp", "1"]);
  const ok = await a.atomic().check(cur).set(["rfp", "1"], "A2").delete(["rfp", "2"]).commit();
  assert(ok.ok);
  assertEquals((await a.get(["rfp", "1"])).value, "A2");
  assertEquals((await b.get(["rfp", "1"])).value, "B");
  const missing = await b.atomic().check({ key: ["rfp", "1"], versionstamp: null }).set(
    ["rfp", "1"],
    "no",
  ).commit();
  assertEquals(missing.ok, false);

  await a.delete(["rfp", "1"]);
  assertEquals((await a.get(["rfp", "1"])).value, null);
  assertEquals((await b.get(["rfp", "1"])).value, "B");
  kv.close();
});

Deno.test("prefixedKv: repos on separate prefixes see separate data", async () => {
  const kv = await Deno.openKv(":memory:");
  const now = () => 1_800_000_000;
  const a = createDb(prefixedKv(kv, "preview"), now);
  const b = createDb(prefixedKv(kv, "prod"), now);
  await a.meta.set("greeting", "hi");
  assertEquals(await a.meta.get("greeting"), "hi");
  assertEquals(await b.meta.get("greeting"), null);
  assert(await a.meta.lock("sync", 60));
  assert(await b.meta.lock("sync", 60)); // same lock name, different namespace
  assertEquals((await kv.get(K.meta("greeting"))).value, null);
  assertEquals((await kv.get(["preview", ...K.meta("greeting")])).value, "hi");
  kv.close();
});
