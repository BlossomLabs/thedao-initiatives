import { assertEquals, assertRejects } from "@std/assert";
import { collectDatasets, stageDataset, versionedKv, withDataset } from "../db/dataset.ts";
import { createDb } from "../db/mod.ts";
import { BACKUP_FORMAT, restoreBackup, validateBackup } from "../services/backup.ts";

Deno.test("dataset: failed staging never changes the active rows, even beyond a transaction", async () => {
  using raw = await Deno.openKv(":memory:");
  const kv = versionedKv(raw);
  await kv.set(["rfp", "existing"], { title: "original" });
  await assertRejects(() =>
    stageDataset(kv, async () => {
      for (let i = 0; i < 40; i++) await kv.set(["rfp", String(i)], "x".repeat(48_000));
      await kv.set(["rfp", "existing"], { title: "modified" });
      throw new Error("injected staging failure");
    })
  );
  assertEquals((await kv.get(["rfp", "existing"])).value, { title: "original" });
  assertEquals((await Array.fromAsync(kv.list({ prefix: ["rfp"] }))).length, 1);
});

Deno.test("dataset: publication pins readers and rejects an old request's unguarded write", async () => {
  using raw = await Deno.openKv(":memory:");
  const kv = versionedKv(raw);
  await kv.set(["rfp", "one"], "old");
  const started = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const reader = withDataset(kv, async () => {
    assertEquals((await kv.get(["rfp", "one"])).value, "old");
    started.resolve();
    await resume.promise;
    assertEquals((await kv.get(["rfp", "one"])).value, "old");
    await assertRejects(() => kv.set(["rfp", "one"], "lost update"), Error, "dataset changed");
  });
  await started.promise;
  await stageDataset(kv, () => kv.set(["rfp", "one"], "new"));
  resume.resolve();
  await reader;
  assertEquals((await kv.get(["rfp", "one"])).value, "new");
});

Deno.test("dataset: a concurrent writer aborts publication without losing the writer", async () => {
  using raw = await Deno.openKv(":memory:");
  const kv = versionedKv(raw);
  await kv.set(["rfp", "one"], "old");
  const staged = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const job = stageDataset(kv, async () => {
    await kv.set(["rfp", "one"], "restored");
    staged.resolve();
    await resume.promise;
  });
  await staged.promise;
  await kv.set(["rfp", "one"], "concurrent");
  resume.resolve();
  await assertRejects(() => job, Error, "dataset changed");
  assertEquals((await kv.get(["rfp", "one"])).value, "concurrent");
});

Deno.test("dataset: repeated large restores keep sessions, leases, ordering and unrelated rows", async () => {
  using raw = await Deno.openKv(":memory:");
  const db = createDb(raw);
  await db.kv.set(["meta", "maintenance"], { on: true });
  await db.kv.set(["session", "live"], "session", { expireIn: 60_000 });
  await db.kv.set(["vote", "relayer"], "lease", { expireIn: 60_000 });
  await db.kv.set(["rfp", "unrelated"], "preserved");
  const backup = validateBackup({
    format: BACKUP_FORMAT,
    entries: Array.from({ length: 64 }, (_, i) => ({ key: ["rfp", i], value: "x".repeat(48_000) })),
  });
  await restoreBackup(db, backup, "replace", db.now);
  await restoreBackup(db, backup, "merge", db.now);
  assertEquals((await db.kv.get(["session", "live"])).value, "session");
  assertEquals((await db.kv.get(["vote", "relayer"])).value, "lease");
  assertEquals((await db.kv.get(["rfp", "unrelated"])).value, "preserved");
  assertEquals(
    (await Array.fromAsync(db.kv.list({ prefix: ["rfp"] }, { limit: 3 }))).map((e) => e.key[1]),
    ["unrelated", 0, 1],
  );
  assertEquals(
    (await Array.fromAsync(db.kv.list({ prefix: ["rfp"] }, { limit: 2, reverse: true }))).map((e) =>
      e.key[1]
    ),
    [63, 62],
  );
  assertEquals(
    (await Array.fromAsync(db.kv.list({ prefix: [] }))).some((e) => e.key[0] === "__dataset"),
    false,
  );
});

Deno.test("dataset: garbage collection preserves live generations and operational state", async () => {
  using raw = await Deno.openKv(":memory:");
  const kv = versionedKv(raw);
  await kv.set(["rfp", "one"], "old");
  await kv.set(["session", "live"], "session");
  await stageDataset(kv, () => kv.set(["rfp", "one"], "new"));
  await raw.set(["__dataset", "retired", "initial"], { at: 0 });
  await raw.set(["__dataset", "staging", "abandoned"], { at: 0 });
  await raw.set(["__dataset", "data", "abandoned", "rfp", "private"], "private");
  await collectDatasets(kv);
  assertEquals((await raw.get(["rfp", "one"])).value, null);
  assertEquals((await raw.get(["__dataset", "data", "abandoned", "rfp", "private"])).value, null);
  assertEquals((await kv.get(["rfp", "one"])).value, "new");
  assertEquals((await kv.get(["session", "live"])).value, "session");
});

Deno.test("dataset: an ambiguous publication result never deletes the published data", async () => {
  using raw = await Deno.openKv(":memory:");
  const proxy = new Proxy(raw, {
    get(target, prop) {
      if (prop === "atomic") {
        return () => {
          const op = target.atomic(), set = op.set.bind(op), commit = op.commit.bind(op);
          let publishing = false;
          op.set = (key, value, options) => {
            if (key[0] === "__dataset" && key[1] === "head") publishing = true;
            return set(key, value, options);
          };
          op.commit = async () => {
            const result = await commit();
            if (publishing) throw new Error("response lost after commit");
            return result;
          };
          return op;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const kv = versionedKv(proxy);
  await kv.set(["rfp", "one"], "old");
  await assertRejects(
    () => stageDataset(kv, () => kv.set(["rfp", "one"], "published")),
    Error,
    "response lost",
  );
  assertEquals((await kv.get(["rfp", "one"])).value, "published");
});

Deno.test("dataset: restoring a later failed batch leaves the active database unchanged", async () => {
  using raw = await Deno.openKv(":memory:");
  let batches = 0;
  const proxy = new Proxy(raw, {
    get(target, prop) {
      if (prop === "atomic") {
        return () => {
          const op = target.atomic(), mutate = op.mutate.bind(op), commit = op.commit.bind(op);
          let restoring = false;
          op.mutate = (...items) => {
            restoring ||= items.some((m) =>
              m.key[3] === "rfp" && String(m.key[4]).startsWith("restored-")
            );
            return mutate(...items);
          };
          op.commit = () =>
            restoring && ++batches === 2
              ? Promise.reject(new Error("injected storage failure"))
              : commit();
          return op;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const db = createDb(proxy);
  await db.kv.set(["meta", "maintenance"], { on: true });
  await db.kv.set(["rfp", "original"], "unchanged");
  const backup = validateBackup({
    format: BACKUP_FORMAT,
    entries: Array.from(
      { length: 64 },
      (_, i) => ({ key: ["rfp", "restored-" + i], value: "x".repeat(48_000) }),
    ),
  });
  await assertRejects(
    () => restoreBackup(db, backup, "replace", db.now),
    Error,
    "injected storage failure",
  );
  assertEquals((await Array.fromAsync(db.kv.list({ prefix: ["rfp"] }))).map((e) => e.value), [
    "unchanged",
  ]);
});
