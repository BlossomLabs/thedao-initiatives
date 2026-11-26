/** On the ballot (#149): an initiative is on it when the production round holds its Safe.
 * Its type and affiliations change only with the round; its goal waits for a round admin. */
import { assertEquals, assertThrows } from "@std/assert";
import { ADMIN, type Harness, harness, j } from "./app-helpers.ts";
import { grantBody, syntheticContentFiles } from "./fixtures.ts";
import { approved, onBallot, OTHER_SAFE, production, putRound, SAFE } from "./ballot-helpers.ts";
import { assertOffBallot, ballotSlot, ON_BALLOT } from "../services/ballot-lock.ts";
import { HttpError } from "../lib/errors.ts";
import { syncKeptNote } from "../services/content.ts";

Deno.test("ballotSlot matches by Safe, in any case; -1 off the ballot, for a test round, or none", () => {
  const m = production([OTHER_SAFE, SAFE]);
  assertEquals(ballotSlot(m, { safeAddress: SAFE.toLowerCase() }), 1);
  assertEquals(ballotSlot(m, { safeAddress: "0xC000000000000000000000000000000000000003" }), -1);
  assertEquals(ballotSlot(m, { safeAddress: "" }), -1);
  assertEquals(ballotSlot({ ...m, kind: "test" }, { safeAddress: SAFE }), -1);
  assertEquals(ballotSlot(undefined, { safeAddress: SAFE }), -1);
});

Deno.test("assertOffBallot refuses only a change on the ballot", () => {
  const e = assertThrows(() => assertOffBallot(true, true), HttpError);
  assertEquals([e.status, e.message], [409, ON_BALLOT]);
  assertOffBallot(true, false);
  assertOffBallot(false, true);
});

Deno.test("PATCH type on the ballot: 409; the same type and other facts: 200", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { patch, row } = await onBallot(h);
    const res = await patch({ type: "grant" });
    assertEquals(res.status, 409);
    assertEquals((await j(res)).error, ON_BALLOT);
    assertEquals((await row()).type, "rfp");
    assertEquals((await patch({ type: "rfp", durationMonths: 12 })).status, 200);
    assertEquals((await row()).durationMonths, 12);
  } finally {
    h.close();
  }
});

Deno.test("a row that took a slug the round still lists is not on the ballot (matched by Safe)", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const { slug, patch } = await approved(h);
    await putRound(h, production([OTHER_SAFE], { slugs: [slug] }));
    assertEquals((await patch({ type: "grant" })).status, 200);
  } finally {
    h.close();
  }
});

async function grantOnBallot(h: Harness, affiliations: string[], ballot = true) {
  const admin = await h.mint(ADMIN, true);
  const id = (await h.db.initiatives.insert({
    title: "A grant on the ballot",
    goalUsd: 50_000,
    status: "approved",
    type: "grant",
    safeAddress: SAFE,
  })).id;
  await h.db.initiatives.update(id, { affiliations });
  if (ballot) await putRound(h, production([SAFE]));
  const set = (affiliations: string) =>
    h.req(`/api/admin/initiatives/${id}`, {
      method: "PATCH",
      token: admin,
      json: { affiliations },
    });
  return { id, set, row: async () => (await h.db.initiatives.get(id))! };
}

Deno.test("affiliations on the ballot: a change is 409, the same list in any case or order is 200", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const g = await grantOnBallot(h, ["SEAL", "Wallets"]);
    const res = await g.set("SEAL");
    assertEquals(res.status, 409);
    assertEquals((await j(res)).error, ON_BALLOT);
    assertEquals((await g.set("wallets, seal")).status, 200);
    assertEquals((await g.row()).affiliations, ["SEAL", "Wallets"]);
  } finally {
    h.close();
  }
});

Deno.test("off the ballot an affiliation's case fix saves", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const g = await grantOnBallot(h, ["seal"], false);
    assertEquals((await g.set("SEAL")).status, 200);
    assertEquals((await g.row()).affiliations, ["SEAL"]);
  } finally {
    h.close();
  }
});

Deno.test("sync-content keeps a ballot initiative's goal, type and affiliations, matched by its row", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  try {
    const admin = await h.mint(ADMIN, true);
    const sync = (files: { name: string; text: string }[]) =>
      h.req("/api/admin/sync-content", { method: "POST", token: admin, json: { files } });
    const grant = syntheticContentFiles()[1];
    assertEquals((await sync([grant])).status, 200);
    const before = (await h.db.initiatives.bySlug("synthetic-grant"))!;
    await h.db.initiatives.update(before.id, { safeAddress: SAFE });
    // The round lists the slot under another slug: the Safe is what counts.
    await putRound(h, production([SAFE], { slugs: ["renamed-elsewhere"] }));
    const text = grant.text
      .replace("goal: 300000", "goal: 250000\naffiliations: SEAL")
      .replace("recipient_url: https://y.example/", "recipient_url: https://z.example/")
      .replace("Synthetic grant one", "Synthetic grant renamed")
      .replace(grantBody(300_000), grantBody(250_000));
    const res = await sync([{ name: grant.name, text }]);
    assertEquals(res.status, 200);
    const out = await j(res);
    assertEquals([out.errors, out.kept], [[], ["synthetic-grant"]]);
    const after = (await h.db.initiatives.get(before.id))!;
    assertEquals([after.goalUsd, after.type, after.affiliations ?? []], [
      before.goalUsd,
      before.type,
      before.affiliations ?? [],
    ]);
    assertEquals([after.recipientUrl, after.title], [
      "https://z.example/",
      "Synthetic grant renamed",
    ]);
  } finally {
    h.close();
  }
});

Deno.test("syncKeptNote names the ballot initiatives whose round facts the sync left alone", () => {
  assertEquals(syncKeptNote([]), null);
  assertEquals(
    syncKeptNote(["valos", "remix"]),
    "On the ballot, so their goal, type and affiliations were left as they are: valos, remix. " +
      "Change a goal from the initiative's edit page; a round admin signs it.",
  );
});
