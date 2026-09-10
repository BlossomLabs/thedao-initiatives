/**
 * One-off import of the Python MVP's rfps.db into Deno KV.
 *
 *   deno task import-sqlite -- --db ../rfps.db [--kv ./.kv]
 *
 * Integer ids become fresh ULIDs; slugs, tx hashes, addresses and timestamps
 * are preserved. Uploaded logos / pfps lived on disk and are not migrated
 * (re-upload through the admin panel, which now pins to IPFS). Safe to re-run:
 * initiatives are matched by slug, donations by (slug, tx hash).
 */
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import { createDb } from "../db/mod.ts";
import type { Rfp } from "../db/types.ts";

const args = parseArgs(Deno.args, { string: ["db", "kv"] });
const dbPath = args.db ?? "../rfps.db";
const sqlite = new DatabaseSync(dbPath, { readOnly: true });
const kv = await Deno.openKv(args.kv || undefined);
const db = createDb(kv);
const rows = <T>(sql: string): T[] => sqlite.prepare(sql).all() as T[];
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// ---- rfps
type OldRfp = Record<string, unknown> & { id: number; slug: string };
const rfpIds = new Map<number, string>();
for (const r of rows<OldRfp>("SELECT * FROM rfps")) {
  let existing = await db.rfps.bySlug(r.slug);
  if (!existing) {
    existing = await db.rfps.insert(
      {
        title: str(r.title),
        summary: str(r.summary),
        details: str(r.details),
        discourseUrl: str(r.discourse_url),
        goalUsd: Number(r.funding_goal_usd ?? 0),
        contact: str(r.contact),
        funders: str(r.funders),
        status: str(r.status) as Rfp["status"],
        type: (str(r.type) || "rfp") as Rfp["type"],
        sortRank: r.sort_rank === null || r.sort_rank === undefined ? null : Number(r.sort_rank),
        safeAddress: str(r.safe_address),
        approvedAt: r.approved_at ? Number(r.approved_at) : null,
      },
      r.slug,
      { author: "", source: "import" },
    );
    // preserve the original creation time
    await kv.set(["rfp", existing.id], { ...existing, createdAt: Number(r.created_at) });
    const rev1 = (await db.revisions.get(existing.id, 1))!;
    await kv.set(["revision", existing.id, 1], { ...rev1, createdAt: Number(r.created_at) });
    console.log(`rfp ${r.slug}: created`);
  } else console.log(`rfp ${r.slug}: exists, skipped`);
  rfpIds.set(r.id, existing.id);
}

// ---- pledges
for (const p of rows<Record<string, unknown>>("SELECT * FROM pledges")) {
  const rfpId = rfpIds.get(Number(p.rfp_id));
  if (!rfpId) continue;
  const have = (await db.pledges.list(rfpId, true)).some((x) =>
    x.company === str(p.company) && x.amountUsd === Number(p.amount_usd)
  );
  if (have) continue;
  await db.pledges.add(rfpId, {
    company: str(p.company),
    amountUsd: Number(p.amount_usd),
    status: str(p.status) as "pledged" | "received" | "withdrawn",
    note: str(p.note),
    url: str(p.url),
    logoCid: "",
  });
  console.log(
    `pledge ${p.company}: imported${p.logo ? " (logo NOT migrated, re-upload)" : ""}`,
  );
}

// ---- donations
for (const d of rows<Record<string, unknown>>("SELECT * FROM donations")) {
  const rfpId = rfpIds.get(Number(d.rfp_id));
  if (!rfpId) continue;
  const tx = str(d.tx_hash).toLowerCase();
  if (await db.donations.get(rfpId, tx)) continue;
  const status = str(d.status);
  await db.donations.record(rfpId, tx, {
    found: status !== "pending",
    pending: status === "pending",
    ok: status === "confirmed",
    tokenSymbol: str(d.token_symbol),
    tokenAddress: str(d.token_address),
    amountRaw: str(d.amount_raw) || "0",
    amount: 0,
    amountUsd: Number(d.amount ?? 0),
    donor: str(d.donor),
    detail: str(d.detail),
  }, "tx");
  console.log(`donation ${tx.slice(0, 10)}…: ${status}`);
}

// ---- comments (two passes: entries, then replies) + votes
const commentIds = new Map<number, string>();
const comments = rows<Record<string, unknown> & { id: number; parent_id: number | null }>(
  "SELECT * FROM comments ORDER BY id",
);
const importComment = async (c: (typeof comments)[number]) => {
  const rfpId = rfpIds.get(Number(c.rfp_id));
  if (!rfpId) return;
  const parentId = c.parent_id ? commentIds.get(Number(c.parent_id)) ?? null : null;
  const created = await db.comments.create({
    rfpId,
    parentId,
    type: str(c.type) as "suggestion" | "question" | "other",
    topic: str(c.topic),
    body: str(c.body),
    displayName: str(c.display_name),
    email: str(c.email),
    address: str(c.address),
    roles: str(c.roles).split(",").filter(Boolean),
    status: str(c.status) as "published" | "held" | "discarded",
    aiSummary: str(c.ai_summary),
  });
  const full = {
    ...created,
    answered: Boolean(c.answered),
    reviewed: Boolean(c.reviewed),
    accepted: Boolean(c.accepted),
    featured: Number(c.featured ?? 0),
    featuredAt: Number(c.featured_at ?? 0),
    votes: Number(c.votes ?? 0),
    reports: Number(c.reports ?? 0),
    createdAt: Number(c.created_at),
  };
  await kv.set(["comment", rfpId, created.id], full);
  commentIds.set(c.id, created.id);
};
for (const c of comments) if (!c.parent_id) await importComment(c);
for (const c of comments) if (c.parent_id) await importComment(c);
for (const v of rows<Record<string, unknown>>("SELECT * FROM comment_votes")) {
  const cid = commentIds.get(Number(v.comment_id));
  if (!cid) continue;
  await kv.set(["vote", cid, str(v.address).toLowerCase()], {
    value: Number(v.value ?? 1),
    at: Number(v.created_at),
  });
}
console.log(`comments: ${commentIds.size} imported`);

// ---- nicknames / profiles
for (const n of rows<Record<string, unknown>>("SELECT * FROM nicknames")) {
  const addr = str(n.address);
  if (str(n.nickname)) await db.profiles.setNickname(addr, str(n.nickname));
  const pfp = str(n.pfp);
  if (pfp.startsWith("preset:")) await db.profiles.setPfp(addr, pfp);
}
console.log("done");
kv.close();
