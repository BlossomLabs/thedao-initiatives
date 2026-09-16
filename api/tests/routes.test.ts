import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import {
  ADMIN,
  deploySafe,
  harness,
  j,
  loadContentFiles,
  ORIGIN,
  PLAIN,
  proposerToken,
  SAFE_ADDR,
  seedContentLogos,
  testConnection,
} from "./app-helpers.ts";
import { DONOR, SIGNERS, transferLog, wallet } from "./helpers.ts";
import { grantBody, minimalSubmission, revisionBody, syntheticContentFiles } from "./fixtures.ts";
import { TOKENS } from "../config.ts";
import { predictSafeAddress } from "../chain/safe.ts";

const USDC = TOKENS.USDC[0];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function seedApproved(h: Awaited<ReturnType<typeof harness>>, safe = SAFE_ADDR) {
  const admin = await h.mint(ADMIN, true);
  await seedContentLogos(h);
  const files = await loadContentFiles();
  const res = await h.req("/api/admin/sync-content", {
    method: "POST",
    token: admin,
    json: { files },
  });
  assertEquals(await j(res), { created: 13, updated: 0, backers: 2, errors: [] });
  const first = (await h.db.rfps.list(["approved"]))[0];
  if (safe) await h.db.rfps.update(first.id, { safeAddress: safe });
  return { admin, first: (await h.db.rfps.get(first.id))! };
}

Deno.test("content sync publishes the repo files as structured rows; public JSON never leaks private fields", async () => {
  const h = await harness();
  const { admin, first } = await seedApproved(h);
  await h.db.rfps.update(first.id, {
    contact: "secret@example.com",
    funders: "SECRET FUNDER LIST",
  });
  const board = await j(await h.req("/api/board"));
  const cards = board.cards as { initiative: Record<string, unknown> }[];
  assertEquals(cards.length, 13);
  const bySlug = Object.fromEntries(
    cards.map((c) => [c.initiative.slug as string, c.initiative]),
  );
  assertEquals(bySlug["privacy-preserving-edr"].type, "grant");
  assertEquals(bySlug["privacy-preserving-edr"].goalUsd, 300000);
  assertEquals(bySlug["end-to-end-formally-verified-vyper-compiler"].goalUsd, 600000);
  // every file split cleanly into the guide's sections and milestones
  for (const c of cards) {
    assertEquals(c.initiative.details, "");
    assertEquals(c.initiative.structured, true);
    assert((c.initiative.milestones as unknown[]).length > 0);
  }
  const ethdebug = (await h.db.rfps.bySlug(
    "source-level-debugging-for-solidity-ethdebug-in-solc",
  ))!;
  assertEquals(ethdebug.topup, true);
  const delivered = ethdebug.milestones.find((m) => m.done)!;
  assert(delivered.link.startsWith("https://"));
  const boardText = JSON.stringify(board);
  assertFalse(boardText.includes("SECRET"));
  assertFalse(boardText.includes("funders"));
  assertFalse(boardText.includes("contact"));
  const page = await j(await h.req("/api/initiatives/" + first.slug));
  assertFalse(JSON.stringify(page).includes("SECRET"));
  const init = page.initiative as {
    details: string;
    structured: boolean;
    sections: Record<string, string>;
    milestones: { amount: number }[];
  };
  assertEquals(init.details, "");
  assert(init.structured);
  assert(init.sections.why);
  assert(init.milestones.length > 0);
  const adminView = await j(
    await h.req("/api/admin/initiatives/" + first.id, { token: admin }),
  );
  assertEquals(
    (adminView.initiative as { funders: string }).funders,
    "SECRET FUNDER LIST",
  );
  // re-sync updates words but never lifecycle/Safe
  await h.db.rfps.update(first.id, { status: "archived" });
  const again = await j(
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: { files: await loadContentFiles() },
    }),
  );
  assertEquals(again, { created: 0, updated: 13, backers: 0, errors: [] });
  for (const r of await h.db.rfps.list(["approved", "pending", "archived"])) {
    assertEquals((await h.db.revisions.list(r.id)).length, 1); // unchanged: no new revision
  }
  assertEquals((await h.db.rfps.get(first.id))!.status, "archived");
  assertEquals((await h.db.rfps.get(first.id))!.safeAddress, SAFE_ADDR);
  const bad = await j(
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: { files: [{ name: "x.md", text: "no frontmatter" }] },
    }),
  );
  assertEquals((bad.errors as string[]).length, 1);
  // A file that does not split cleanly is refused, the error says what is
  // missing, and no row is written for it.
  const broken = syntheticContentFiles()[0];
  const noScope = await j(
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: {
        files: [{
          name: "broken.md",
          text: broken.text.replace("## Out of scope\n\nOther things.\n", ""),
        }],
      },
    }),
  ) as { created: number; errors: string[] };
  assertEquals(noScope.created, 0);
  assertEquals(noScope.errors, ["broken.md: not structured: missing: Out of scope"]);
  assertEquals(await h.db.rfps.bySlug("broken"), null);
  h.close();
});

Deno.test("board ordering: pins first, then money, then newest", async () => {
  const h = await harness();
  const mk = async (title: string, rank: number | null) => {
    h.clock.now += 10;
    return await h.db.rfps.insert({
      title,
      status: "approved",
      sortRank: rank,
      goalUsd: 1000,
    });
  };
  const a = await mk("Alpha initiative", null);
  const b = await mk("Beta initiative", null);
  const c = await mk("Gamma initiative", 2);
  const d = await mk("Delta initiative", 1);
  await h.db.pledges.add(a.id, {
    company: "X",
    amountUsd: 500,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  const board = await j(await h.req("/api/board"));
  const order = (board.cards as { initiative: { id: string } }[]).map((x) => x.initiative.id);
  assertEquals(order, [d.id, c.id, a.id, b.id]);
  assertEquals((board.totals as { raised: number }).raised, 500);
  h.close();
});

Deno.test("submit: needs a signed-in wallet with a display name; records the proposer", async () => {
  const h = await harness({
    fetch: (url) =>
      url.startsWith("https://api.ensdata.net/")
        ? new Response("", { status: 404 })
        : new Response("", { status: 404 }),
  });
  const good = minimalSubmission(25000);
  assertEquals((await h.req("/api/initiatives", { method: "POST", json: good })).status, 401);
  const nameless = await h.mint(PLAIN);
  const noName = await h.req("/api/initiatives", { method: "POST", token: nameless, json: good });
  assertEquals(noName.status, 403);
  assertStringIncludes(String((await j(noName)).error), "display name");
  const token = await proposerToken(h);
  const res = await h.req("/api/initiatives", { method: "POST", token, json: good });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const row = (await h.db.rfps.bySlug(slug))!;
  assertEquals(row.proposer, PLAIN);
  // public once approved, proposer included
  const admin = await h.mint(ADMIN, true);
  await deploySafe(h, admin, row.id);
  await h.req(`/api/admin/initiatives/${row.id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  const pub = await j(await h.req("/api/initiatives/" + slug));
  assertEquals((pub.initiative as { proposer: string }).proposer, PLAIN);
  h.close();
});

Deno.test("submit: validation, honeypot, rate limit, pending never on board", async () => {
  const h = await harness();
  let token = await proposerToken(h);
  const good = minimalSubmission(25000);
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      token,
      json: { ...good, website: "bot" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      token,
      json: { ...good, title: "short" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      token,
      json: { ...good, summary: "too short" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", { method: "POST", token, json: { ...good, funders: "" } }))
      .status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", { method: "POST", token, json: { ...good, goal: "-5" } }))
      .status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      token,
      json: { ...good, discourseUrl: "http://forum.example/t/1" },
    })).status,
    400,
  );
  h.clock.now += 3601; // invalid attempts count against the 5/hour budget, as in the MVP
  token = await proposerToken(h); // the earlier session has passed its inactivity limit
  const res = await h.req("/api/initiatives", {
    method: "POST",
    token,
    json: { ...good, type: "junk" },
  });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const row = (await h.db.rfps.bySlug(slug))!;
  assertEquals(row.status, "pending");
  assertEquals(row.type, "rfp");
  assertEquals(row.goalUsd, 25000);
  assertEquals(row.funders, good.funders);
  assertEquals((await h.req("/api/initiatives/" + slug)).status, 404);
  assertEquals(((await j(await h.req("/api/board"))).cards as unknown[]).length, 0);
  for (let i = 0; i < 4; i++) {
    await h.req("/api/initiatives", { method: "POST", token, json: good });
  }
  assertEquals(
    (await h.req("/api/initiatives", { method: "POST", token, json: good })).status,
    429,
  );
  h.close();
});

Deno.test("mine: a proposer lists and opens their own submissions, rejected ones only for them and admins", async () => {
  const h = await harness();
  const token = await proposerToken(h);
  const stranger = await proposerToken(h, DONOR);
  const admin = await h.mint(ADMIN, true);
  const submit = async (tok: string, goal: number) => {
    const res = await h.req("/api/initiatives", {
      method: "POST",
      token: tok,
      json: minimalSubmission(goal),
    });
    assertEquals(res.status, 201);
    return (await j(res)).slug as string;
  };
  const first = await submit(token, 25000);
  h.clock.now += 1;
  const second = await submit(token, 26000);
  const theirs = await submit(stranger, 27000);
  const rejected = (await h.db.rfps.bySlug(first))!;
  await h.req(`/api/admin/initiatives/${rejected.id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "reject" },
  });

  assertEquals((await h.req("/api/initiatives/mine")).status, 401);
  const mine = (await j(await h.req("/api/initiatives/mine", { token }))).initiatives as Record<
    string,
    unknown
  >[];
  assertEquals(mine.map((x) => [x.slug, x.status]), [[second, "pending"], [first, "rejected"]]);
  assertEquals(Object.keys(mine[0]).sort(), [
    "createdAt",
    "goalUsd",
    "slug",
    "status",
    "title",
    "type",
  ]);
  const others = (await j(await h.req("/api/initiatives/mine", { token: stranger })))
    .initiatives as { slug: string }[];
  assertEquals(others.map((x) => x.slug), [theirs]);

  // A rejected row opens for its proposer and admins, and nobody else.
  assertEquals((await h.req("/api/initiatives/" + first, { token })).status, 200);
  assertEquals((await h.req("/api/initiatives/" + first, { token: admin })).status, 200);
  assertEquals((await h.req("/api/initiatives/" + first, { token: stranger })).status, 404);
  assertEquals((await h.req("/api/initiatives/" + first)).status, 404);
  assertEquals((await h.req(`/api/initiatives/${first}/revisions/1`, { token })).status, 200);
  assertEquals(
    (await h.req(`/api/initiatives/${first}/revisions/1`, { token: stranger })).status,
    404,
  );
  // Viewable is not editable.
  assertEquals(
    (await h.req("/api/initiatives/" + first, {
      method: "PATCH",
      token,
      json: { initiativeId: rejected.id, goal: "30000" },
    })).status,
    403,
  );
  assertEquals(
    (await h.req(`/api/initiatives/${first}/revisions`, {
      method: "POST",
      token,
      json: { initiativeId: rejected.id, ...revisionBody(minimalSubmission(31000)) },
    })).status,
    403,
  );
  h.close();
});

Deno.test("SIWE: nonce -> verify -> session; reuse, wrong domain, admin flag, logout", async () => {
  const h = await harness();
  const w = wallet("0x" + "11".repeat(32)); // = ADMIN
  const { nonce } = await j(await h.req("/api/auth/nonce")) as { nonce: string };
  const msg = (n: string, domain = "localhost:5173") =>
    `${domain} wants you to sign in with your Ethereum account:\n${w.address}\n\nSign in to TheDAO Security Fund\n\n` +
    `URI: ${ORIGIN}\nVersion: 1\nChain ID: 1\nNonce: ${n}\nIssued At: ${
      new Date(h.clock.now * 1000).toISOString()
    }`;
  const bad = await h.req("/api/auth/verify", {
    method: "POST",
    json: {
      message: msg(nonce, "evil.example"),
      signature: await w.sign(msg(nonce, "evil.example")),
    },
  });
  assertEquals(bad.status, 401);
  // The host the page was served on is accepted even when not configured.
  const { nonce: n0 } = await j(await h.req("/api/auth/nonce")) as { nonce: string };
  const own = msg(n0, "preview.deno.net").replace(
    `URI: ${ORIGIN}`,
    "URI: https://preview.deno.net",
  );
  const onSelf = await h.app.request("https://preview.deno.net/api/auth/verify", {
    method: "POST",
    headers: { Origin: "https://preview.deno.net", "Content-Type": "application/json" },
    body: JSON.stringify({ message: own, signature: await w.sign(own) }),
  }, testConnection());
  assertEquals(onSelf.status, 200);
  // A forged Host outside the platform suffixes does not widen the binding.
  const { nonce: n1 } = await j(await h.req("/api/auth/nonce")) as { nonce: string };
  const forged = msg(n1, "evil.example").replace(`URI: ${ORIGIN}`, "URI: https://evil.example");
  const onForged = await h.app.request("https://evil.example/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: forged, signature: await w.sign(forged) }),
  }, testConnection());
  assertEquals(onForged.status, 401);
  const res = await h.req("/api/auth/verify", {
    method: "POST",
    json: { message: msg(nonce), signature: await w.sign(msg(nonce)) },
  });
  assertEquals(res.status, 200);
  const body = await j(res) as { token: string; address: string; isAdmin: boolean };
  assertEquals(body.address, ADMIN);
  assertEquals(body.isAdmin, true);
  const reuse = await h.req("/api/auth/verify", {
    method: "POST",
    json: { message: msg(nonce), signature: await w.sign(msg(nonce)) },
  });
  assertEquals(reuse.status, 401);
  assertStringIncludes(String((await j(reuse)).error), "nonce");
  const me = await j(await h.req("/api/auth/me", { token: body.token }));
  assertEquals(me.address, ADMIN);
  assertEquals((await h.req("/api/auth/me")).status, 401);
  assertEquals((await h.req("/api/admin/dashboard", { token: body.token })).status, 200);
  await h.req("/api/auth/logout", { method: "POST", token: body.token });
  assertEquals((await h.req("/api/auth/me", { token: body.token })).status, 401);
  // a non-admin wallet gets a plain session (past the per-IP login window)
  h.clock.now += 61;
  const p = wallet("0x" + "22".repeat(32));
  const { nonce: n2 } = await j(await h.req("/api/auth/nonce")) as { nonce: string };
  const m2 = msg(n2).replace(w.address, p.address);
  const r2 = await j(
    await h.req("/api/auth/verify", {
      method: "POST",
      json: { message: m2, signature: await p.sign(m2) },
    }),
  ) as { token: string; isAdmin: boolean };
  assertEquals(r2.isAdmin, false);
  assertEquals((await h.req("/api/admin/dashboard", { token: r2.token })).status, 403);
  h.close();
});

Deno.test("origin guard and CORS", async () => {
  const h = await harness();
  const res = await h.app.request("http://api.test/api/initiatives", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: "{}",
  });
  assertEquals(res.status, 403);
  // Same-origin on a host that is not in WEB_ORIGIN (a *.deno.net preview URL)
  // passes: the origin the request was served on is always its own.
  const self = await h.app.request("https://preview.deno.net/api/initiatives", {
    method: "POST",
    headers: { Origin: "https://preview.deno.net", "Content-Type": "application/json" },
    body: "{}",
  });
  assertEquals(self.status, 401);
  // ...but an unlisted host outside the platform suffixes is still refused.
  const other = await h.app.request("https://other.example/api/initiatives", {
    method: "POST",
    headers: { Origin: "https://other.example", "Content-Type": "application/json" },
    body: "{}",
  });
  assertEquals(other.status, 403);
  const pre = await h.app.request("http://api.test/api/board", {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  assertEquals(pre.headers.get("access-control-allow-origin"), ORIGIN);
  assertStringIncludes(
    pre.headers.get("access-control-allow-headers") ?? "",
    "Authorization",
  );
  const get = await h.req("/api/board");
  assertEquals(get.headers.get("x-content-type-options"), "nosniff");
  h.close();
});

Deno.test("donate: params, confirm, status, totals", async () => {
  const h = await harness();
  const { first } = await seedApproved(h);
  const params = await j(await h.req("/api/donate/params")) as {
    enabled: boolean;
    tokens: Record<string, unknown>;
    rates: Record<string, number>;
  };
  assert(params.enabled);
  assertEquals(params.rates.ETH, 2000);
  assertEquals(params.rates.USDC, 1);
  assertEquals(Object.keys(params.tokens).length, 10);
  const tx = "0x" + "ab".repeat(32);
  h.script.receipts[tx] = {
    status: "0x1",
    blockNumber: "0x100",
    logs: [transferLog(USDC, PLAIN, SAFE_ADDR, 250_000_000n)],
  };
  const conf = await j(
    await h.req("/api/donate/confirm", {
      method: "POST",
      json: { slug: first.slug, txHash: tx },
    }),
  );
  assertEquals(conf.status, "confirmed");
  assertEquals(conf.amountUsd, 250);
  const st = await j(await h.req("/api/donate/status/" + tx));
  assertEquals(st.status, "confirmed");
  assertEquals(st.amount, 250);
  // Before a balance snapshot exists, paint the ledger immediately.
  const snapshot = await j(await h.req("/api/initiatives/" + first.slug)) as {
    summary: { donated: number; live: boolean };
  };
  assertEquals(snapshot.summary.donated, 250);
  assertFalse(snapshot.summary.live);
  // Refresh replaces that fallback with the Safe's balance (zero on this fake chain).
  const page = await j(await h.req("/api/initiatives/" + first.slug + "?refresh=1")) as {
    summary: { donated: number; ledger: number; live: boolean };
    donations: unknown[];
  };
  assertEquals(page.summary.ledger, 250);
  assertEquals(page.summary.donated, 0);
  assert(page.summary.live);
  assertEquals(page.donations.length, 1);
  assertEquals(
    (await h.req("/api/donate/confirm", {
      method: "POST",
      json: { slug: first.slug, txHash: "0x12" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/donate/confirm", {
      method: "POST",
      json: { slug: "nope", txHash: tx },
    })).status,
    404,
  );
  assertEquals((await h.req("/api/donate/status/0x" + "ff".repeat(32))).status, 404);
  // pending -> confirmed via status poll once mined deep enough
  const tx2 = "0x" + "cd".repeat(32);
  h.script.txs[tx2] = { hash: tx2 };
  const p = await j(
    await h.req("/api/donate/confirm", {
      method: "POST",
      json: { slug: first.slug, txHash: tx2 },
    }),
  );
  assertEquals(p.status, "pending");
  h.script.receipts[tx2] = {
    status: "0x1",
    blockNumber: "0x3e0",
    logs: [transferLog(USDC, PLAIN, SAFE_ADDR, 1_000_000n)],
  };
  h.clock.now += 10;
  assertEquals((await j(await h.req("/api/donate/status/" + tx2))).status, "confirmed");
  h.close();
});

Deno.test("profile: nickname rules, .eth ownership, pfp presets and upload", async () => {
  let pinataAuth = "";
  const h = await harness({
    env: { PINATA_JWT: "jwt-test" },
    fetch: (url, init) => {
      if (url.startsWith("https://api.ensdata.net/griff.eth")) {
        return Response.json({ address: ADMIN });
      }
      if (url.startsWith("https://api.ensdata.net/" + PLAIN)) {
        return Response.json({
          ens: "plain.eth",
          address: PLAIN,
          avatar: "ipfs://bafy-raw-record",
          avatar_url: "https://euc.li/plain.eth",
        });
      }
      if (url.startsWith("https://uploads.pinata.cloud/")) {
        pinataAuth = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({
          data: { cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" },
        });
      }
      return new Response("nope", { status: 404 });
    },
  });
  const admin = await h.mint(ADMIN);
  const plain = await h.mint(PLAIN);
  assertEquals(
    (await h.req("/api/nickname", { method: "POST", json: { nickname: "Griff" } }))
      .status,
    401,
  );
  assertEquals(
    (await h.req("/api/nickname", {
      method: "POST",
      token: plain,
      json: { nickname: "bad name!" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/nickname", {
      method: "POST",
      token: plain,
      json: { nickname: "Griff" },
    })).status,
    200,
  );
  assertEquals(
    (await h.req("/api/nickname", {
      method: "POST",
      token: admin,
      json: { nickname: "griff" },
    })).status,
    409,
  );
  assertEquals(
    (await h.req("/api/nickname", {
      method: "POST",
      token: plain,
      json: { nickname: "griff.eth" },
    })).status,
    403,
  );
  assertEquals(
    (await h.req("/api/nickname", {
      method: "POST",
      token: admin,
      json: { nickname: "griff.eth" },
    })).status,
    200,
  );
  assertEquals((await j(await h.req("/api/nickname/" + ADMIN))).nickname, "griff.eth");
  assertEquals(await j(await h.req("/api/ens-name/" + PLAIN)), {
    name: "plain.eth",
    avatar: "https://euc.li/plain.eth",
  });
  assertEquals(await j(await h.req("/api/ens-name/" + ADMIN)), { name: null, avatar: null });
  assertEquals((await h.req("/api/ens-name/0x123")).status, 400);
  assertEquals(
    (await h.req("/api/pfp", { method: "POST", token: plain, json: { pfp: "preset:7" } }))
      .status,
    200,
  );
  assertEquals(
    (await h.req("/api/pfp", { method: "POST", token: plain, json: { pfp: "upload:x" } }))
      .status,
    400,
  );
  const form = new FormData();
  form.append("image", new Blob([PNG], { type: "image/png" }), "me.png");
  const up = await h.req("/api/pfp/upload", { method: "POST", token: plain, body: form });
  assertEquals(up.status, 200);
  const upj = await j(up) as { pfp: string; pfpUrl: string };
  assert(upj.pfp.startsWith("ipfs:bafy"));
  assertStringIncludes(upj.pfpUrl, "ipfs.blossom.software/ipfs/bafy");
  assertEquals(pinataAuth, "Bearer jwt-test");
  const junk = new FormData();
  junk.append(
    "image",
    new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])]),
    "x.png",
  );
  assertEquals(
    (await h.req("/api/pfp/upload", { method: "POST", token: plain, body: junk })).status,
    400,
  );
  h.close();
});

Deno.test("admin: edit, status, pledges with logo, safe deploy params + confirm, comments actions", async () => {
  const h = await harness({
    env: { PINATA_JWT: "jwt" },
    fetch: (url) =>
      url.startsWith("https://uploads.pinata.cloud/")
        ? Response.json({
          data: { cid: "bafylogo1234567890123456789012345678901234567890" },
        })
        : new Response("", { status: 404 }),
  });
  const admin = await h.mint(ADMIN, true);
  const sub = await j(
    await h.req("/api/initiatives", {
      method: "POST",
      token: await proposerToken(h),
      json: minimalSubmission(1000),
    }),
  ) as { slug: string };
  const id = (await h.db.rfps.bySlug(sub.slug))!.id;
  assertEquals((await h.req("/api/admin/dashboard")).status, 401);
  const dash = await j(await h.req("/api/admin/dashboard", { token: admin })) as {
    pendingCount: number;
    signers: { ok: boolean };
  };
  assertEquals(dash.pendingCount, 1);
  assert(dash.signers.ok);
  const patched = await j(
    await h.req("/api/admin/initiatives/" + id, {
      method: "PATCH",
      token: admin,
      json: {
        title: "Renamed initiative",
        sortRank: "3",
        type: "grant",
        goal: "2,000",
        proposer: ADMIN.toLowerCase(),
      },
    }),
  ) as { initiative: Record<string, unknown> };
  assertEquals(patched.initiative.title, "Renamed initiative");
  assertEquals(patched.initiative.sortRank, 3);
  assertEquals(patched.initiative.goalUsd, 2000);
  assertEquals(patched.initiative.proposer, ADMIN);
  assertEquals(
    (await h.req("/api/admin/initiatives/" + id, {
      method: "PATCH",
      token: admin,
      json: { proposer: "not an owner" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/admin/initiatives/" + id, {
      method: "PATCH",
      token: admin,
      json: { title: "short" },
    })).status,
    400,
  );
  // deploy the Safe (deploy first, approve second)
  const key = (await h.db.rfps.get(id))!.safeDeploymentKey!;
  h.script.code[predictSafeAddress(SIGNERS, key).toLowerCase()] = "0x6080";
  const conf = await j(
    await h.req("/api/admin/initiatives/" + id + "/safe-confirm", {
      method: "POST",
      token: admin,
      json: {},
    }),
  ) as { status: string; address: string };
  assertEquals(conf.status, "ok");
  assertEquals(conf.address, predictSafeAddress(SIGNERS, key));
  const approved = await j(
    await h.req("/api/admin/initiatives/" + id + "/status", {
      method: "POST",
      token: admin,
      json: { action: "approve" },
    }),
  ) as { initiative: { status: string; approvedAt: number; safeAddress: string } };
  assertEquals(approved.initiative.status, "approved");
  assert(approved.initiative.approvedAt);
  assertEquals(approved.initiative.safeAddress, conf.address);
  // pledges: JSON then multipart with logo
  const p1 = await h.req("/api/admin/initiatives/" + id + "/pledges", {
    method: "POST",
    token: admin,
    json: { company: "Acme", amount: "500", url: "javascript:alert(1)" },
  });
  assertEquals(p1.status, 201);
  assertEquals(((await j(p1)).pledge as { url: string }).url, "");
  const form = new FormData();
  form.append("company", "Logo Co");
  form.append("url", "https://logo.example");
  form.append("amount", "250");
  form.append("status", "received");
  form.append("logo", new Blob([PNG], { type: "image/png" }), "logo.png");
  const p2 = await j(
    await h.req("/api/admin/initiatives/" + id + "/pledges", {
      method: "POST",
      token: admin,
      body: form,
    }),
  ) as { pledge: { id: string; logoUrl: string } };
  assertStringIncludes(p2.pledge.logoUrl, "/ipfs/bafylogo");
  const card = ((await j(await h.req("/api/board"))).cards as {
    logos: unknown[];
    backers: number;
    summary: { pledged: number };
  }[])[0];
  assertEquals(card.backers, 2);
  assertEquals(card.logos, [{
    company: "Logo Co",
    logoUrl: p2.pledge.logoUrl,
    url: "https://logo.example",
  }]);
  assertEquals(card.summary.pledged, 750);
  await h.req("/api/admin/initiatives/" + id + "/pledges/" + p2.pledge.id, {
    method: "PATCH",
    token: admin,
    json: { status: "withdrawn" },
  });
  assertEquals((await h.db.fundingSummary(id)).pledged, 500);
  h.close();
});

Deno.test("ai-search: mocked provider, unknown ids dropped, cache, disabled", async () => {
  const off = await harness();
  assertEquals(
    (await off.req("/api/ai-search", { method: "POST", json: { query: "compilers" } }))
      .status,
    503,
  );
  off.close();
  let calls = 0;
  const h = await harness({
    env: { AI_SEARCH_API_KEY: "k" },
    fetch: (url, init) => {
      if (!url.includes("/chat/completions")) return new Response("", { status: 404 });
      calls++;
      // The reasoning model must not think out loud: it blew the 25 s budget.
      assertEquals(JSON.parse(String(init?.body)).reasoning_effort, "none");
      const ids = ["bogus", ...knownIds];
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ ranked_ids: ids }) } }],
      });
    },
  });
  const a = await h.db.rfps.insert({ title: "Alpha initiative", status: "approved" });
  const b = await h.db.rfps.insert({ title: "Beta initiative", status: "approved" });
  const knownIds = [b.id, a.id];
  assertEquals(
    (await h.req("/api/ai-search", { method: "POST", json: { query: "ab" } })).status,
    400,
  );
  const res = await j(
    await h.req("/api/ai-search", {
      method: "POST",
      json: { query: "verified compilers" },
    }),
  );
  assertEquals(res.matches, [b.id, a.id]);
  await h.req("/api/ai-search", {
    method: "POST",
    json: { query: "Verified Compilers" },
  });
  assertEquals(calls, 1); // cached
  h.close();
});

Deno.test("submit: discussion links are stored without fetching; title is required", async () => {
  const h = await harness({
    env: { ONRAMP_API_KEY: "tk" },
  });
  const good = minimalSubmission(1000);
  const token = await proposerToken(h);
  const res = await h.req("/api/initiatives", {
    method: "POST",
    token,
    json: { ...good, discourseUrl: "https://forum.example.org/t/my-initiative/123" },
  });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  const row = (await h.db.rfps.bySlug(slug))!;
  assertEquals(row.title, good.title);
  assertEquals(row.discourseUrl, "https://forum.example.org/t/my-initiative/123");
  const noTitle = await h.req("/api/initiatives", {
    method: "POST",
    token,
    json: { ...good, title: "", discourseUrl: "https://forum.example.org/t/no-title/9" },
  });
  assertEquals(noTitle.status, 400);
  assertStringIncludes(String((await j(noTitle)).error), "give the initiative a title");
  const { title: _noTitle, ...withoutTitle } = good;
  const nothing = await h.req("/api/initiatives", { method: "POST", token, json: withoutTitle });
  assertEquals(nothing.status, 400);
  assertStringIncludes(String((await j(nothing)).error), "give the initiative a title");
  const badHost = await h.req("/api/initiatives", {
    method: "POST",
    token,
    json: { ...good, discourseUrl: "https://forum.invalid/t/x/1" },
  });
  assertEquals(badHost.status, 400);
  assertEquals(h.fetchLog, []);
  // board cards carry the card-checkout template once a Safe exists
  const admin = await h.mint(ADMIN, true);
  const id = (await h.db.rfps.bySlug(slug))!.id;
  const safe = await deploySafe(h, admin, id);
  await h.req(`/api/admin/initiatives/${id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  const card = ((await j(await h.req("/api/board"))).cards as {
    onramp: { url: string; prefilled: boolean };
  }[])[0];
  assert(card.onramp.prefilled);
  assertStringIncludes(card.onramp.url, "walletAddress=" + safe);
  h.close();
});

Deno.test("content backers: file pledges are created once, kept in step, never own the status", async () => {
  const h = await harness();
  const { admin } = await seedApproved(h);
  // the repo files: one backer each on ethdebug and formal verification
  const fv = (await h.db.rfps.bySlug("securing-ethereum-with-formal-verification"))!;
  assertEquals(fv.discourseUrl, "https://t.me/+PHZekKhdjPAxOWU0");
  assertEquals(fv.recipientTeam, "Verity Labs");
  const fvPledges = await h.db.pledges.list(fv.id);
  assertEquals(fvPledges.length, 1);
  assertEquals(fvPledges[0].company, "Ethereum Foundation");
  assertEquals(fvPledges[0].amountUsd, 100000);
  assertEquals(fvPledges[0].url, "https://ethereum.foundation/");
  assertEquals(fvPledges[0].status, "pledged");
  const eth = (await h.db.rfps.bySlug("source-level-debugging-for-solidity-ethdebug-in-solc"))!;
  const ethPledges = await h.db.pledges.list(eth.id);
  assertEquals(ethPledges.map((p) => [p.company, p.amountUsd]), [["Argot Collective", 151000]]);
  const board = await j(await h.req("/api/board"));
  const card = (board.cards as { initiative: { slug: string }; summary: { pledged: number } }[])
    .find((c) => c.initiative.slug === fv.slug)!;
  assertEquals(card.summary.pledged, 100000);

  const sync = async (files: { name: string; text: string }[]) =>
    j(await h.req("/api/admin/sync-content", { method: "POST", token: admin, json: { files } }));
  const file = (backers: string) => ({
    name: "grant-b.md",
    text: "---\ntitle: Grant B\ngoal: 100\ntype: grant\nrecipient: Team B\nbackers:\n" +
      backers + "---\n" + grantBody(100),
  });
  // created with two pledges; the admin marks one received and adds a third
  const s1 = await sync([file("  Acme | $60 | https://acme.example/\n  - Beta Org | 40\n")]);
  assertEquals([s1.created, s1.backers, s1.errors], [1, 2, []]);
  const gb = (await h.db.rfps.bySlug("grant-b"))!;
  let rows = await h.db.pledges.list(gb.id);
  assertEquals(rows.map((p) => [p.company, p.amountUsd, p.url]), [
    ["Acme", 60, "https://acme.example/"],
    ["Beta Org", 40, ""],
  ]);
  await h.db.pledges.setStatus(gb.id, rows[0].id, "received");
  await h.db.pledges.add(gb.id, {
    company: "Admin Only",
    amountUsd: 5,
    status: "pledged",
    note: "",
    url: "",
    logoCid: "",
  });
  // the same file again: nothing changes
  const s2 = await sync([file("  Acme | $60 | https://acme.example/\n  Beta Org | 40\n")]);
  assertEquals([s2.updated, s2.backers, s2.errors], [1, 0, []]);
  // a new amount and spelling update the matching row; status and the admin's row survive
  const s3 = await sync([file("  ACME | $70 | https://acme.example/\n  Beta Org | 40\n")]);
  assertEquals([s3.updated, s3.backers], [1, 1]);
  rows = await h.db.pledges.list(gb.id, true);
  assertEquals(
    rows.map((p) => [p.company, p.amountUsd, p.status]).sort(),
    [["ACME", 70, "received"], ["Admin Only", 5, "pledged"], ["Beta Org", 40, "pledged"]].sort(),
  );
  // dropping a line withdraws nothing: that stays the admin's call
  const s4 = await sync([file("  ACME | $70 | https://acme.example/\n")]);
  assertEquals(s4.backers, 0);
  assertEquals((await h.db.pledges.list(gb.id, true)).length, 3);
  // bad blocks are file errors, and no row is written
  for (
    const bad of [
      "  Acme\n",
      "  Acme | 0\n",
      "  Acme | 5 | http://x.example/\n",
      "  A | 1\n  a | 2\n",
    ]
  ) {
    const r = await sync([{ ...file(bad), name: "grant-bad.md" }]);
    assertEquals(r.created, 0);
    assertStringIncludes((r.errors as string[])[0], "backers");
  }
  assertEquals(await h.db.rfps.bySlug("grant-bad"), null);
});

Deno.test("page facts: content keys sync, admin patch validates and clears per type", async () => {
  const h = await harness();
  const { admin } = await seedApproved(h);
  const board = await j(await h.req("/api/board"));
  const bySlug = Object.fromEntries(
    (board.cards as { initiative: Record<string, unknown> }[]).map((
      c,
    ) => [c.initiative.slug as string, c.initiative]),
  );
  // content/rfps front matter: duration on most files, topup + reviewer on ethdebug
  assertEquals(bySlug["end-to-end-formally-verified-vyper-compiler"].durationMonths, 12);
  assertEquals(bySlug["end-to-end-formally-verified-vyper-compiler"].topup, false);
  const ethdebug = bySlug["source-level-debugging-for-solidity-ethdebug-in-solc"];
  assertEquals(ethdebug.topup, true);
  assertEquals(ethdebug.durationMonths, null);
  assertStringIncludes(String(ethdebug.milestoneReviewer), "Nicholas");
  const rows = ethdebug.milestones as { done: boolean; link: string; month: string }[];
  assert(rows.some((m) => m.done && m.link.startsWith("https://")));
  assert(rows.some((m) => !m.done && /^\d{4}-\d{2}$/.test(m.month)));
  // web-only keys, and topup on an RFP is an error
  const sync = await j(
    await h.req("/api/admin/sync-content", {
      method: "POST",
      token: admin,
      json: {
        files: [
          {
            name: "grant-x.md",
            text: "---\ntitle: Grant X\ngoal: 100\ntype: grant\nduration: 3\n" +
              "recipient: Team X\nrecipient_url: https://x.example/team#top\n---\n" +
              grantBody(100),
          },
          {
            name: "bad-topup.md",
            text: "---\ntitle: Bad\ngoal: 100\ntopup: true\n---\nbody",
          },
          {
            name: "bad-url.md",
            text: "---\ntitle: Bad\ngoal: 100\ntype: grant\nrecipient: T\n" +
              "recipient_url: javascript:alert(1)\n---\nbody",
          },
        ],
      },
    }),
  );
  assertEquals(sync.created, 1);
  assertEquals((sync.errors as string[]).length, 2);
  const gx = (await h.db.rfps.bySlug("grant-x"))!;
  assertEquals(gx.durationMonths, 3);
  assertEquals(gx.recipientTeam, "Team X");
  assertEquals(gx.recipientUrl, "https://x.example/team#top");

  const patch = (json: Record<string, unknown>) =>
    h.req("/api/admin/initiatives/" + gx.id, { method: "PATCH", token: admin, json });
  const p1 = await j(
    await patch({ topup: true, milestoneReviewer: "Rev", durationMonths: "" }),
  ) as { initiative: Record<string, unknown> };
  assertEquals(p1.initiative.topup, true);
  assertEquals(p1.initiative.milestoneReviewer, "Rev");
  assertEquals(p1.initiative.durationMonths, null);
  assertEquals((await patch({ durationMonths: "1.5" })).status, 400);
  assertEquals((await patch({ durationMonths: "500" })).status, 400);
  assertEquals((await patch({ recipientUrl: "http://x.example/" })).status, 400);
  assertEquals((await patch({ recipientUrl: "javascript:alert(1)" })).status, 400);
  // dropping the top-up flag clears the reviewer; switching to RFP clears the grant fields
  const p2 = await j(await patch({ topup: false })) as { initiative: Record<string, unknown> };
  assertEquals(p2.initiative.milestoneReviewer, "");
  const p3 = await j(await patch({ type: "rfp" })) as {
    initiative: Record<string, unknown>;
    findings: { errors: { field: string }[] };
  };
  assertEquals(p3.initiative.recipientTeam, "");
  assertEquals(p3.initiative.recipientUrl, "");
  assertEquals(p3.initiative.topup, false);
  // the structured body is re-cut for the new type: grant-only sections go,
  // and the RFP sections it now lacks come back as non-blocking findings
  assertEquals(Object.keys(p3.initiative.sections as object).sort(), [
    "in_scope",
    "out_scope",
    "why",
  ]);
  assert(p3.findings.errors.some((e) => e.field === "hard_req"));
  // the public page carries the facts and nothing private
  const page = await j(await h.req("/api/initiatives/grant-x")) as {
    initiative: Record<string, unknown>;
  };
  assertEquals(page.initiative.durationMonths, null);
  assert("topup" in page.initiative);
  h.close();
});

Deno.test("DISABLE_RATE_LIMITS=true: the submit limit stops counting", async () => {
  const h = await harness({ env: { DISABLE_RATE_LIMITS: "true" } });
  const token = await proposerToken(h);
  for (let i = 0; i < 8; i++) {
    const res = await h.req("/api/initiatives", {
      method: "POST",
      token,
      json: {
        ...minimalSubmission(25_000 + i * 1_000), // a different body each time: the exact-text guard is not the limit
        title: `Initiative number ${i} of the session`,
        summary: `Submission ${i} from a room that shares one IP address during a live session.`,
      },
    });
    assertEquals(res.status, 201, await res.text());
  }
  h.close();
});
