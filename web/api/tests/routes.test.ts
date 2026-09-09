import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j, loadContentFiles, ORIGIN, PLAIN, SAFE_ADDR } from "./app-helpers.ts";
import { transferLog, wallet } from "./helpers.ts";
import { TOKENS } from "../config.ts";
import { TOPIC_PROXY_CREATION } from "../chain/safe.ts";
import { SAFE_PROXY_FACTORY } from "../config.ts";

const USDC = TOKENS.USDC[0];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function seedApproved(h: Awaited<ReturnType<typeof harness>>, safe = SAFE_ADDR) {
  const admin = await h.mint(ADMIN, true);
  const files = await loadContentFiles();
  const res = await h.req("/api/admin/sync-content", {
    method: "POST",
    token: admin,
    json: { files },
  });
  assertEquals(res.status, 200);
  const first = (await h.db.rfps.list(["approved"]))[0];
  if (safe) await h.db.rfps.update(first.id, { safeAddress: safe });
  return { admin, first: (await h.db.rfps.get(first.id))! };
}

Deno.test("content sync publishes the repo files; public JSON never leaks private fields", async () => {
  const h = await harness();
  const { admin, first } = await seedApproved(h);
  await h.db.rfps.update(first.id, {
    contact: "secret@example.com",
    funders: "SECRET FUNDER LIST",
  });
  const board = await j(await h.req("/api/board"));
  const cards = board.cards as { initiative: Record<string, unknown> }[];
  assertEquals(cards.length, 5);
  const bySlug = Object.fromEntries(
    cards.map((c) => [c.initiative.slug as string, c.initiative]),
  );
  assertEquals(bySlug["privacy-preserving-edr"].type, "grant");
  assertEquals(bySlug["privacy-preserving-edr"].goalUsd, 300000);
  assertEquals(bySlug["end-to-end-formally-verified-vyper-compiler"].goalUsd, 600000);
  const boardText = JSON.stringify(board);
  assertFalse(boardText.includes("SECRET"));
  assertFalse(boardText.includes("funders"));
  assertFalse(boardText.includes("contact"));
  const page = await j(await h.req("/api/initiatives/" + first.slug));
  assertFalse(JSON.stringify(page).includes("SECRET"));
  assert(
    String((page.initiative as { details: string }).details).includes(
      "## Why this matters",
    ),
  );
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
  assertEquals(again, { created: 0, updated: 5, errors: [] });
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

Deno.test("submit: validation, honeypot, rate limit, pending never on board", async () => {
  const h = await harness();
  const good = {
    title: "A proper initiative title",
    summary: "This summary is comfortably longer than the forty character minimum required.",
    goal: "25,000",
    funders: "Some L2 and a wallet company",
    type: "grant",
    contact: "me@example.com",
  };
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      json: { ...good, website: "bot" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      json: { ...good, title: "short" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      json: { ...good, summary: "too short" },
    })).status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", { method: "POST", json: { ...good, funders: "" } }))
      .status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", { method: "POST", json: { ...good, goal: "-5" } }))
      .status,
    400,
  );
  assertEquals(
    (await h.req("/api/initiatives", {
      method: "POST",
      json: { ...good, discourseUrl: "http://forum.example/t/1" },
    })).status,
    400,
  );
  h.clock.now += 3601; // invalid attempts count against the 5/hour budget, as in the MVP
  const res = await h.req("/api/initiatives", {
    method: "POST",
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
    await h.req("/api/initiatives", { method: "POST", json: good });
  }
  assertEquals(
    (await h.req("/api/initiatives", { method: "POST", json: good })).status,
    429,
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
      signature: w.sign(msg(nonce, "evil.example")),
    },
  });
  assertEquals(bad.status, 401);
  const res = await h.req("/api/auth/verify", {
    method: "POST",
    json: { message: msg(nonce), signature: w.sign(msg(nonce)) },
  });
  assertEquals(res.status, 200);
  const body = await j(res) as { token: string; address: string; isAdmin: boolean };
  assertEquals(body.address, ADMIN);
  assertEquals(body.isAdmin, true);
  const reuse = await h.req("/api/auth/verify", {
    method: "POST",
    json: { message: msg(nonce), signature: w.sign(msg(nonce)) },
  });
  assertEquals(reuse.status, 401);
  assertStringIncludes(String((await j(reuse)).error), "nonce");
  const me = await j(await h.req("/api/auth/me", { token: body.token }));
  assertEquals(me.address, ADMIN);
  assertEquals((await h.req("/api/auth/me")).status, 401);
  assertEquals((await h.req("/api/admin/dashboard", { token: body.token })).status, 200);
  await h.req("/api/auth/logout", { method: "POST", token: body.token });
  assertEquals((await h.req("/api/auth/me", { token: body.token })).status, 401);
  // a non-admin wallet gets a plain session
  const p = wallet("0x" + "22".repeat(32));
  const { nonce: n2 } = await j(await h.req("/api/auth/nonce")) as { nonce: string };
  const m2 = msg(n2).replace(w.address, p.address);
  const r2 = await j(
    await h.req("/api/auth/verify", {
      method: "POST",
      json: { message: m2, signature: p.sign(m2) },
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
  const page = await j(await h.req("/api/initiatives/" + first.slug)) as {
    summary: { donated: number };
    donations: unknown[];
  };
  assertEquals(page.summary.donated, 250);
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
        return Response.json({ ens: "plain.eth", address: PLAIN });
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
  assertEquals((await j(await h.req("/api/ens-name/" + PLAIN))).name, "plain.eth");
  assertEquals((await j(await h.req("/api/ens-name/" + ADMIN))).name, null);
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
  assertStringIncludes(upj.pfpUrl, "gateway.pinata.cloud/ipfs/bafy");
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
      json: {
        title: "A proper initiative title",
        summary: "x".repeat(50),
        goal: 1000,
        funders: "someone somewhere",
        contact: "c@x.y",
      },
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
      json: { title: "Renamed initiative", sortRank: "3", type: "grant", goal: "2,000" },
    }),
  ) as { initiative: Record<string, unknown> };
  assertEquals(patched.initiative.title, "Renamed initiative");
  assertEquals(patched.initiative.sortRank, 3);
  assertEquals(patched.initiative.goalUsd, 2000);
  assertEquals(
    (await h.req("/api/admin/initiatives/" + id, {
      method: "PATCH",
      token: admin,
      json: { title: "short" },
    })).status,
    400,
  );
  const approved = await j(
    await h.req("/api/admin/initiatives/" + id + "/status", {
      method: "POST",
      token: admin,
      json: { action: "approve" },
    }),
  ) as { initiative: { status: string; approvedAt: number } };
  assertEquals(approved.initiative.status, "approved");
  assert(approved.initiative.approvedAt);
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
  assertEquals(card.logos.length, 1);
  assertEquals(card.summary.pledged, 750);
  await h.req("/api/admin/initiatives/" + id + "/pledges/" + p2.pledge.id, {
    method: "PATCH",
    token: admin,
    json: { status: "withdrawn" },
  });
  assertEquals((await h.db.fundingSummary(id)).pledged, 500);
  // Safe deploy
  const params = await j(
    await h.req("/api/admin/initiatives/" + id + "/safe-deploy-params", { token: admin }),
  ) as { enabled: boolean; calldata: string; factory: string };
  assert(params.enabled);
  assert(params.calldata.startsWith("0x1688f0b9"));
  assertEquals(params.factory, SAFE_PROXY_FACTORY);
  const deployTx = "0x" + "ee".repeat(32);
  h.script.receipts[deployTx] = {
    status: "0x1",
    logs: [{
      address: SAFE_PROXY_FACTORY.toLowerCase(),
      topics: [
        TOPIC_PROXY_CREATION,
        "0x" + "0".repeat(24) + SAFE_ADDR.slice(2).toLowerCase(),
      ],
      data: "0x",
    }],
  };
  const conf = await j(
    await h.req("/api/admin/initiatives/" + id + "/safe-confirm", {
      method: "POST",
      token: admin,
      json: { txHash: deployTx },
    }),
  ) as { status: string; address: string };
  assertEquals(conf.status, "ok");
  assertEquals(conf.address, SAFE_ADDR);
  assertEquals((await h.db.rfps.get(id))!.safeAddress, SAFE_ADDR);
  // same Safe cannot bind to another initiative
  const other = await h.db.rfps.insert({
    title: "Another initiative",
    status: "approved",
  });
  const dup = await h.req("/api/admin/initiatives/" + other.id + "/safe-confirm", {
    method: "POST",
    token: admin,
    json: { txHash: deployTx },
  });
  assertEquals(dup.status, 409);
  assertEquals(
    (await h.req("/api/admin/initiatives/" + id + "/safe-confirm", {
      method: "POST",
      token: admin,
      json: { txHash: "0x12" },
    })).status,
    400,
  );
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
    fetch: (url) => {
      if (!url.includes("/chat/completions")) return new Response("", { status: 404 });
      calls++;
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

Deno.test("submit: blank title is read from the Discourse topic; forum errors are honest", async () => {
  const h = await harness({
    env: { ONRAMP_API_KEY: "tk" },
    fetch: (url, init) => {
      if (url === "https://forum.example.org/t/my-initiative/123.json") {
        assertEquals((init as RequestInit).redirect, "manual");
        return Response.json({ title: "Source-level debugging for Solidity", id: 123 });
      }
      if (url.endsWith("/no-title/9.json")) return Response.json({ id: 9 });
      return new Response("", { status: 404 });
    },
  });
  const good = { summary: "x".repeat(50), goal: 1000, funders: "someone somewhere" };
  const res = await h.req("/api/initiatives", {
    method: "POST",
    json: { ...good, discourseUrl: "https://forum.example.org/t/my-initiative/123" },
  });
  assertEquals(res.status, 201);
  const { slug } = await j(res) as { slug: string };
  assertEquals(
    (await h.db.rfps.bySlug(slug))!.title,
    "Source-level debugging for Solidity",
  );
  const noTitle = await h.req("/api/initiatives", {
    method: "POST",
    json: { ...good, discourseUrl: "https://forum.example.org/t/no-title/9" },
  });
  assertEquals(noTitle.status, 400);
  assertStringIncludes(String((await j(noTitle)).error), "could not read a title");
  const nothing = await h.req("/api/initiatives", { method: "POST", json: good });
  assertEquals(nothing.status, 400);
  assertStringIncludes(String((await j(nothing)).error), "forum link");
  const badHost = await h.req("/api/initiatives", {
    method: "POST",
    json: { ...good, discourseUrl: "https://forum.invalid/t/x/1" },
  });
  assertEquals(badHost.status, 400);
  // board cards carry the card-checkout template once a Safe exists
  const admin = await h.mint(ADMIN, true);
  const id = (await h.db.rfps.bySlug(slug))!.id;
  await h.req(`/api/admin/initiatives/${id}/status`, {
    method: "POST",
    token: admin,
    json: { action: "approve" },
  });
  await h.db.rfps.update(id, { safeAddress: SAFE_ADDR });
  const card = ((await j(await h.req("/api/board"))).cards as {
    onramp: { url: string; prefilled: boolean };
  }[])[0];
  assert(card.onramp.prefilled);
  assertStringIncludes(card.onramp.url, "walletAddress=" + SAFE_ADDR);
  h.close();
});
