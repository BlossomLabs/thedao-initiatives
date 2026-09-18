import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  ADMIN,
  harness as appHarness,
  type HarnessOptions,
  j,
  loadContentFiles,
  PLAIN,
  SAFE_ADDR,
  seedContentLogos,
} from "./app-helpers.ts";
import { K } from "../db/keys.ts";
import { SESSION_REAUTH_SECS } from "../config.ts";
import type { AuditEvent } from "../services/audit.ts";
import { BACKUP_FORMAT, BACKUP_PREFIXES, type BackupFile } from "../services/backup.ts";

const TX1 = "0x" + "e1".repeat(32);
const DONOR = "0x" + "44".repeat(20);

async function harness(opts?: HarnessOptions) {
  const h = await appHarness(opts);
  const logs: string[] = [];
  h.deps.log = (line) => logs.push(line);
  return { ...h, logs };
}
type H = Awaited<ReturnType<typeof harness>>;
const events = (h: H): AuditEvent[] =>
  h.logs.filter((line) => line.startsWith('{"securityAudit":true,')).map((line) =>
    JSON.parse(line)
  );
const forRequest = (h: H, r: Response) =>
  events(h).filter((e) => e.requestId === r.headers.get("X-Request-ID"));

const enter = (h: H, token: string) =>
  h.req("/api/admin/maintenance/enter", { method: "POST", token, json: {} });
const exit = (h: H, token: string) =>
  h.req("/api/admin/maintenance/exit", { method: "POST", token, json: {} });
const restore = (h: H, token: string, json: unknown) =>
  h.req("/api/admin/restore", { method: "POST", token, json });

async function countPrefix(kv: Deno.Kv, prefix: string): Promise<number> {
  let n = 0;
  for await (const _ of kv.list({ prefix: [prefix] })) n++;
  return n;
}

/** Every record type the site keeps, plus rows that must never leave. */
async function seed(h: H) {
  const admin = await h.mint(ADMIN, true);
  await seedContentLogos(h);
  const files = await loadContentFiles();
  const synced = await j(
    await h.req("/api/admin/sync-content", { method: "POST", token: admin, json: { files } }),
  );
  assertEquals(synced.errors, []);
  const first = (await h.db.initiatives.list(["approved"]))[0];
  await h.db.initiatives.update(first.id, { safeAddress: SAFE_ADDR, contact: "a@b.c" });
  await h.db.pledges.add(first.id, {
    company: "Backer Co",
    amountUsd: 1000,
    status: "received",
    note: "n",
    url: "https://backer.example",
    logoCid: "bafylogo",
  });
  await h.kv.set(K.donation(first.id, TX1), {
    rfpId: first.id,
    txHash: TX1,
    tokenSymbol: "USDC",
    tokenAddress: "0x1",
    amountRaw: "1000000",
    amountUsd: 1,
    donor: DONOR,
    status: "confirmed",
    detail: "",
    source: "tx",
    createdAt: h.clock.now,
    confirmedAt: h.clock.now,
  });
  await h.kv.set(K.donationByTx(TX1, first.id), true);
  const base = {
    rfpId: first.id,
    parentId: null,
    type: "question" as const,
    topic: "t",
    body: "published body",
    displayName: "Ann",
    email: "ann@example.org",
    address: PLAIN,
    roles: [] as string[],
    status: "published" as const,
    aiSummary: "",
  };
  const published = await h.db.comments.create(base, true);
  await h.db.comments.create({ ...base, body: "a reply", parentId: published.id });
  const held = await h.db.comments.create({ ...base, body: "held body", status: "held" });
  await h.db.comments.setVote(published.id, ADMIN, 1);
  await h.db.profiles.setNickname(PLAIN, "donor");
  await h.deps.admins.add(PLAIN);
  const acceptance = await h.db.terms.record({
    sessionHash: "s".repeat(64),
    initiativeId: first.id,
    chainId: 1,
    recipient: SAFE_ADDR,
    version: "v1",
    method: "wallet",
  });
  await h.db.terms.attach(acceptance, TX1);
  await h.db.meta.setSafeSync(first.id, {
    at: h.clock.now,
    lastTxHash: TX1,
    ok: true,
    error: "",
    backfilled: true,
    resumeUrl: "",
  });
  await h.kv.set(K.safeBalances(SAFE_ADDR), {
    value: { usd: 1, holdings: [], at: h.clock.now },
    refreshAfter: h.clock.now + 120,
  });
  // Rows that never leave: sessions (minted above), a nonce, a counter, an
  // upload receipt, a lock, and the claim index (rebuilt on restore).
  await h.db.sessions.issueNonce();
  await h.kv.set(K.rl("x", 0), 1);
  await h.kv.set(K.upload("bafyup"), { address: PLAIN, at: h.clock.now });
  await h.db.meta.lock("l", 60);
  return { admin, first, held };
}

Deno.test("backup: an admin downloads every record; secrets, TTL rows and the maintenance flag stay out", async () => {
  const h = await harness();
  try {
    const { first } = await seed(h);
    const stale = await h.mint(ADMIN, true);
    h.clock.now += SESSION_REAUTH_SECS;
    const staleRes = await h.req("/api/admin/backup", { token: stale });
    assertEquals(staleRes.status, 403);
    assertEquals((await j(staleRes)).reauthenticate, true);
    assertEquals((await h.req("/api/admin/backup", { token: await h.mint(PLAIN) })).status, 403);

    const fresh = await h.mint(ADMIN, true);
    assertEquals((await enter(h, fresh)).status, 200);
    const res = await h.req("/api/admin/backup", { token: fresh });
    assertEquals(res.status, 200);
    assertMatch(
      res.headers.get("content-disposition") ?? "",
      /^attachment; filename="thedao-kv-backup-\d{8}T\d{6}Z\.json"$/,
    );
    assertEquals(res.headers.get("cache-control"), "no-store");
    const backup = await res.json() as BackupFile;
    assertEquals(backup.format, BACKUP_FORMAT);
    assertMatch(backup.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert(backup.entries.length > 20);
    for (const e of backup.entries) {
      assert(
        (BACKUP_PREFIXES as readonly string[]).includes(String(e.key[0])),
        `exported ${e.key[0]}`,
      );
    }
    const keys = backup.entries.map((e) => JSON.stringify(e.key));
    assertEquals(new Set(keys).size, keys.length, "keys are unique");
    for (const prefix of BACKUP_PREFIXES) {
      const expected = await countPrefix(h.kv, prefix) - (prefix === "meta" ? 1 : 0);
      assertEquals(backup.prefixes[prefix] ?? 0, expected, prefix);
    }
    assert(!keys.includes(JSON.stringify(["meta", "maintenance"])));
    for (
      const prefix of ["session", "sessions_by_addr", "nonce", "rl", "upload", "lock", "claim"]
    ) {
      assert(!backup.entries.some((e) => e.key[0] === prefix), `${prefix} leaked`);
    }
    const row = backup.entries.find((e) => e.key[0] === "rfp" && e.key[1] === first.id)!;
    assertEquals((row.value as { contact: string }).contact, "a@b.c");
    assertEquals(
      forRequest(h, res).filter((e) => e.action === "backup.export").map((e) => e.outcome),
      ["success"],
    );

    // A value the format cannot carry is an error, never a silent loss.
    await h.kv.set(["rfp", "bad"], { n: 1n });
    const bad = await h.req("/api/admin/backup", { token: fresh });
    assertEquals(bad.status, 500);
    assertEquals((await j(bad)).error, "backup: unsupported value under rfp");
  } finally {
    h.close();
  }
});

Deno.test("backup: restore is idempotent, only while paused, never deletes, and reproduces the pages", async () => {
  const a = await harness();
  const b = await harness();
  try {
    const { admin: adminA, first, held } = await seed(a);
    await enter(a, adminA);
    const backup = await (await a.req("/api/admin/backup", { token: adminA })).json() as BackupFile;
    await exit(a, adminA);

    const adminB = await b.mint(ADMIN, true);
    const extra = await b.db.initiatives.insert({ title: "Only in B", status: "approved" });
    const off = await restore(b, adminB, { backup });
    assertEquals(off.status, 409);
    assertEquals((await j(off)).error, "Turn maintenance mode on before restoring a backup.");
    assertEquals(await countPrefix(b.kv, "rfp"), 1);

    await enter(b, adminB);
    const merged = await restore(b, adminB, { backup });
    assertEquals(merged.status, 200);
    assertEquals(await j(merged), {
      written: backup.entries.length,
      skipped: 0,
      claimsRebuilt: 1,
    });
    const audited = forRequest(b, merged).filter((e) => e.action === "backup.restore");
    assertEquals(audited.map((e) => e.outcome), ["attempt", "success"]);
    assertEquals(audited[1].detail, "merge");
    assertEquals(await b.deps.maintenance.fresh().then((s) => s.on), true, "flag untouched");
    assertEquals((await b.db.initiatives.get(extra.id))!.title, "Only in B");
    assertEquals(await b.deps.admins.isAdmin(PLAIN), true);

    // The held comment's claim works again on the restored site.
    const mine = await j(
      await b.req("/api/comments/mine", { method: "POST", json: { tokens: [held.claimToken] } }),
    );
    assertEquals((mine.held as { id: string }[]).map((x) => x.id), [held.id]);

    // Same rows, same pages.
    await exit(b, adminB);
    await b.db.initiatives.update(extra.id, { status: "archived" });
    for (
      const path of [
        "/api/board",
        `/api/initiatives/${first.slug}`,
        `/api/initiatives/${first.slug}/comments`,
      ]
    ) {
      assertEquals(await j(await b.req(path)), await j(await a.req(path)), path);
    }

    // Again: nothing to do. Replace: the row comes back, B's own history stays.
    await enter(b, adminB);
    assertEquals(await j(await restore(b, adminB, { backup })), {
      written: 0,
      skipped: backup.entries.length,
      claimsRebuilt: 0,
    });
    const before = (await b.db.revisions.list(first.id, true)).length;
    await b.db.initiatives.revise(first.id, { ...first, title: "Changed in B" }, {
      author: "",
      source: "admin",
    });
    assertEquals((await b.db.initiatives.get(first.id))!.title, "Changed in B");
    const replaced = await j(await restore(b, adminB, { backup, mode: "replace" }));
    assertEquals(replaced.written, backup.entries.length);
    assertEquals(await b.db.initiatives.get(first.id), await a.db.initiatives.get(first.id));
    assertEquals((await b.db.revisions.list(first.id, true)).length, before + 1);
  } finally {
    a.close();
    b.close();
  }
});

Deno.test("backup: a bad file is refused whole, and a big valid one fits", async () => {
  const h = await harness();
  try {
    const admin = await h.mint(ADMIN, true);
    await enter(h, admin);
    const ok = { key: ["rfp", "id1"], value: { id: "id1" } };
    const file = (entries: unknown, extra: Record<string, unknown> = {}) => ({
      backup: { format: BACKUP_FORMAT, exportedAt: "x", prefixes: {}, entries },
      ...extra,
    });
    const cases: [unknown, string][] = [
      [{ backup: { format: "nope", entries: [] } }, "Not a thedao-kv-backup/1 file."],
      [file([ok], { mode: "wipe" }), "mode must be merge or replace"],
      [
        file([{ key: ["session", "h"], value: {} }]),
        'entry 0: key prefix "session" is not restorable',
      ],
      [file([{ key: ["rfp", true], value: {} }]), "entry 0: key parts must be strings or numbers"],
      [file([{ key: ["rfp", "id1"] }]), "entry 0: value is missing"],
      [
        file([{ key: ["rfp", "id1"], value: { big: "x".repeat(70_000) } }]),
        "entry 0: value exceeds 64 KiB",
      ],
      [file([ok, ok]), "entry 1: duplicate key"],
    ];
    for (const [json, error] of cases) {
      const res = await h.req("/api/admin/restore", { method: "POST", token: admin, json });
      assertEquals(res.status, 400, error);
      assertEquals((await j(res)).error, error);
    }
    assertEquals(await countPrefix(h.kv, "rfp"), 0, "nothing written by a refused file");

    // The maintenance flag inside a file is ignored, counted as skipped.
    const flag = await j(
      await h.req("/api/admin/restore", {
        method: "POST",
        token: admin,
        json: file([{
          key: ["meta", "maintenance"],
          value: { on: false, by: "", at: 0, note: "" },
        }]),
      }),
    );
    assertEquals(flag, { written: 0, skipped: 1, claimsRebuilt: 0 });
    assertEquals((await h.deps.maintenance.fresh()).on, true);

    // ~3 MB of logo records is over the API's usual 2 MB cap and still restores.
    const big = Array.from({ length: 64 }, (_, i) => ({
      key: ["content_logo", `logo-${i}.png`],
      value: { name: `logo-${i}.png`, cid: "bafy", sha256: "s".repeat(48_000), at: 1 },
    }));
    const body = JSON.stringify(file(big));
    assert(body.length > 3_000_000);
    const large = await h.req("/api/admin/restore", {
      method: "POST",
      token: admin,
      headers: { "content-type": "application/json" },
      body,
    });
    assertEquals(large.status, 200);
    assertEquals((await j(large)).written, 64);
    const tooBig = await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      headers: { "content-type": "application/json" },
      body,
    });
    assertEquals(tooBig.status, 413, "other routes keep the 2 MB cap");
  } finally {
    h.close();
  }
});
