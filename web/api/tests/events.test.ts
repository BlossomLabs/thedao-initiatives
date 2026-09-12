import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { harness, SAFE_ADDR } from "./app-helpers.ts";
import { siteLockFor } from "../app.ts";
import { K } from "../db/keys.ts";

const TX = "0x" + "c1".repeat(32);
const confirmed = {
  found: true,
  pending: false,
  ok: true,
  tokenSymbol: "USDC",
  tokenAddress: "0x" + "a0".repeat(20),
  amountRaw: "1000000",
  amount: 1,
  amountUsd: 1,
  donor: "0x" + "44".repeat(20),
  detail: "verified",
};

const version = async (kv: Deno.Kv, rfpId: string) =>
  (await kv.get<Deno.KvU64>(K.fundingVersion(rfpId))).value?.value ?? 0n;

/** Read SSE frames until one carries `event: funding` (bounded). */
async function nextFunding(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const dec = new TextDecoder();
  let buf = "";
  for (let i = 0; i < 20; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    const m = /event: funding\ndata: (\d+)\n/.exec(buf);
    if (m) return m[1];
  }
  throw new Error("no funding event in: " + JSON.stringify(buf));
}

Deno.test("funding version: donation and pledge writes bump it inside the same atomic op", async () => {
  const h = await harness();
  const rfp = await h.db.rfps.insert({
    title: "Versioned",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  assertEquals(await version(h.kv, rfp.id), 0n);
  await h.db.donations.record(rfp.id, TX, { ...confirmed, pending: true, ok: false }, "tx");
  assertEquals(await version(h.kv, rfp.id), 1n);
  await h.db.donations.record(rfp.id, TX, confirmed, "tx");
  assertEquals(await version(h.kv, rfp.id), 2n);
  // already confirmed: no write, no bump
  await h.db.donations.record(rfp.id, TX, confirmed, "tx");
  assertEquals(await version(h.kv, rfp.id), 2n);
  const p = await h.db.pledges.add(rfp.id, {
    company: "Acme",
    amountUsd: 500,
    url: "",
    note: "",
    logoCid: "",
    status: "pledged",
  });
  assertEquals(await version(h.kv, rfp.id), 3n);
  await h.db.pledges.update(rfp.id, p.id, { amountUsd: 600 });
  await h.db.pledges.setStatus(rfp.id, p.id, "withdrawn");
  await h.db.pledges.remove(rfp.id, p.id);
  assertEquals(await version(h.kv, rfp.id), 6n);
  h.close();
});

Deno.test("funding events: streams the current version, then one event per write; site lock cookie passes", async () => {
  const h = await harness({ env: { SITE_USERNAME: "preview", SITE_PASSWORD: "secret" } });
  const rfp = await h.db.rfps.insert({
    title: "Live initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: SAFE_ADDR,
  });
  const path = `/api/initiatives/${rfp.slug}/events`;
  // EventSource cannot send a bearer header; without the cookie the lock says no.
  assertEquals((await h.req(path)).status, 401);
  assertEquals((await h.req("/api/initiatives/nope/events")).status, 401);

  const cookie = (await siteLockFor(h.deps).cookie()).split(";")[0];
  assertEquals(
    (await h.req("/api/initiatives/nope/events", { headers: { Cookie: cookie } })).status,
    404,
  );

  const res = await h.req(path, { headers: { Cookie: cookie } });
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/event-stream");
  const reader = res.body!.getReader();
  assertEquals(await nextFunding(reader), "0");

  await h.db.donations.record(rfp.id, TX, confirmed, "tx");
  assertEquals(await nextFunding(reader), "1");

  await h.db.pledges.add(rfp.id, {
    company: "Acme",
    amountUsd: 500,
    url: "",
    note: "",
    logoCid: "",
    status: "pledged",
  });
  assertEquals(await nextFunding(reader), "2");

  await reader.cancel();
  h.close();
});

Deno.test("funding events: a pending initiative streams only for its proposer or an admin", async () => {
  const h = await harness();
  const rfp = await h.db.rfps.insert({ title: "Hidden", status: "pending", goalUsd: 1 });
  assertEquals((await h.req(`/api/initiatives/${rfp.slug}/events`)).status, 404);
  const admin = await h.mint("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A", true);
  const res = await h.req(`/api/initiatives/${rfp.slug}/events`, { token: admin });
  assertEquals(res.status, 200);
  const reader = res.body!.getReader();
  assert((await nextFunding(reader)) === "0");
  await reader.cancel();
  h.close();
});
