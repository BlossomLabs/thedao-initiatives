import { assertEquals } from "@std/assert";
import { BACKUP_FORMAT, type BackupEntry, type BackupFile } from "../services/backup.ts";
import { withRelayer } from "../routes/vote.ts";
import { ADMIN, harness } from "./app-helpers.ts";

const contract = "0x" + "12".repeat(20);
const transient: BackupEntry[] = [
  { key: ["vote", "relayer"], value: "orphan-from-old-backup" },
  { key: ["vote", contract, "pending", "1", "2"], value: { hash: "0xab", at: 100 } },
  { key: ["vote", contract, "pledge-outcome", "initiative", "pledge"], value: { state: "landed" } },
  { key: ["vote", contract, "round"], value: { at: 100 } },
  { key: ["vote", contract, "ballots"], value: { at: 100 } },
  { key: ["vote", contract, "corrections1", 1, 2, "round"], value: { at: 100 } },
  { key: ["vote", contract, "corrections1", 1, 2, "0xanchor", "ballots"], value: { at: 100 } },
];
const durable: BackupEntry[] = [
  { key: ["vote", "relayer-nonce", 1], value: { next: 12, hash: "0xab", at: 100 } },
  { key: ["vote", contract, "relays", "1"], value: 3 },
  { key: ["vote", contract, "gas", "1"], value: true },
  { key: ["vote", contract, "pledge-pending", "initiative", "pledge"], value: { hash: "0xab" } },
  { key: ["vote", "comment-id", contract], value: 1 },
  { key: ["vote", contract, "settled-w1", "S"], value: { at: 100 } },
];

Deno.test("backup during a relayer send excludes transient vote records and keeps durable votes", async () => {
  const h = await harness();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const sending = withRelayer(h.kv, () => {
    started.resolve();
    return release.promise;
  });
  try {
    await started.promise;
    for (const e of transient.slice(1)) await h.kv.set(e.key, e.value, { expireIn: 120_000 });
    for (const e of durable) await h.kv.set(e.key, e.value);
    const response = await h.req("/api/admin/backup", { token: await h.mint(ADMIN, true) });
    assertEquals(response.status, 200);
    const backup = await response.json() as BackupFile;
    assertEquals(backup.prefixes.vote, durable.length);
    for (const e of transient) {
      assertEquals(
        backup.entries.some((b) => JSON.stringify(b.key) === JSON.stringify(e.key)),
        false,
      );
    }
    for (const e of durable) {
      assertEquals(backup.entries.find((b) => JSON.stringify(b.key) === JSON.stringify(e.key)), e);
    }
  } finally {
    release.resolve();
    await sending;
    h.close();
  }
});

Deno.test("merge and replace restore skip historical vote leases and preserve an active destination lease", async () => {
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    exportedAt: "fixture",
    prefixes: {},
    entries: [...transient, ...durable],
  };
  for (const mode of ["merge", "replace"]) {
    for (const active of [false, true]) {
      const h = await harness();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let sending: Promise<void> | undefined;
      try {
        if (active) {
          sending = withRelayer(h.kv, () => {
            started.resolve();
            return release.promise;
          });
          await started.promise;
        }
        const before = await h.kv.get(["vote", "relayer"]);
        const token = await h.mint(ADMIN, true);
        const maintenance = await h.req("/api/admin/maintenance/enter", {
          method: "POST",
          token,
          json: {},
        });
        assertEquals(maintenance.status, 200);
        await maintenance.arrayBuffer();
        const response = await h.req("/api/admin/restore", {
          method: "POST",
          token,
          json: { mode, backup },
        });
        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
          written: durable.length,
          skipped: transient.length,
          claimsRebuilt: 0,
        });
        assertEquals(await h.kv.get(["vote", "relayer"]), before);
        for (const e of transient.slice(1)) assertEquals((await h.kv.get(e.key)).value, null);
        for (const e of durable) assertEquals((await h.kv.get(e.key)).value, e.value);
        release.resolve();
        await sending;
        // No retry loop or expiry wait: the restored database can send immediately.
        assertEquals(await withRelayer(h.kv, () => Promise.resolve("sent")), "sent");
        assertEquals((await h.kv.get(["vote", "relayer"])).value, null);
      } finally {
        release.resolve();
        await sending;
        h.close();
      }
    }
  }
});
