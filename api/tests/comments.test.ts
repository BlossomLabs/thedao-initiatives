import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, CURATOR, harness, j, PLAIN } from "./app-helpers.ts";
import { sortEntries } from "../routes/comments.ts";
import { TOKENS } from "../config.ts";
import { transferLog } from "./helpers.ts";
import { K } from "../db/keys.ts";
import { CLAIM_TTL_SECS } from "../db/comments.ts";

const EXPERT = "0x3333333333333333333333333333333333333333";
const DONOR = "0x4444444444444444444444444444444444444444";
const PROPOSER = "0x5555555555555555555555555555555555555555";

Deno.test("comment claim rotation cannot be overwritten by a concurrent review", async () => {
  const { h, post } = await setup();
  try {
    const held = await j(await post(undefined, { name: "Author" })) as {
      id: string;
      claimToken: string;
    };
    let token = held.claimToken;
    for (let i = 0; i < 5; i++) {
      const [rotated] = await Promise.all([
        h.db.comments.rotateClaimToken(token),
        h.db.comments.set(held.id, { reviewed: true }),
      ]);
      if (rotated) token = rotated.claimToken;
      assertEquals((await h.db.comments.byClaimTokens([token])).map((c) => c.id), [held.id]);
      assertEquals((await h.db.comments.get(held.id))?.reviewed, true);
    }
  } finally {
    h.close();
  }
});

Deno.test("comment claims: POST only, bounded input, rotation, expiry and moderation revocation", async () => {
  const { h, post } = await setup();
  try {
    const logs: string[] = [];
    h.deps.log = (line) => logs.push(line);
    const held = await j(await post(undefined, { name: "Author", body: "private held text" })) as {
      id: string;
      claimToken: string;
    };
    const mine = (tokens: unknown) =>
      h.req("/api/comments/mine", { method: "POST", json: { tokens } });
    assertEquals((await h.req("/api/comments/mine?tokens=" + held.claimToken)).status, 404);
    for (const invalid of ["not-an-array", ["malformed"], Array(21).fill(held.claimToken)]) {
      assertEquals((await mine(invalid)).status, 400);
    }
    assertEquals((await j(await mine(["0".repeat(32)]))).held, []);
    assertEquals((await mine([held.claimToken])).headers.get("Cache-Control"), "no-store");
    const rotate = (token: string) =>
      h.req("/api/comments/claims/rotate", { method: "POST", json: { token } });
    const result = await rotate(held.claimToken);
    assertEquals(result.status, 200);
    const replacement = await j(result) as { claimToken: string };
    assert(replacement.claimToken !== held.claimToken);
    assertEquals((await rotate(held.claimToken)).status, 404);
    assertEquals((await j(await mine([held.claimToken]))).held, []);
    assertEquals(((await j(await mine([replacement.claimToken]))).held as unknown[]).length, 1);
    h.clock.now += CLAIM_TTL_SECS;
    assertEquals((await j(await mine([replacement.claimToken]))).held, []);
    assertEquals((await rotate(replacement.claimToken)).status, 404);
    assertEquals((await h.db.comments.get(held.id))?.body, "private held text");

    const next = await j(await post(undefined, { name: "Author" })) as {
      id: string;
      claimToken: string;
    };
    await h.db.comments.set(next.id, { status: "discarded" });
    assertEquals((await h.kv.get(K.claim(next.claimToken))).value, null);
    assertEquals((await rotate(next.claimToken)).status, 404);
    // Legacy claims have the same absolute lifetime, even when their KV index had no TTL.
    const row = (await h.db.comments.get(held.id))!;
    const { claimExpiresAt: _expiry, ...legacy } = row;
    await h.kv.set(K.comment(row.rfpId, row.id), legacy);
    assertEquals(await h.db.comments.byClaimTokens([replacement.claimToken]), []);
    const output = logs.join("\n");
    for (const secret of [held.claimToken, replacement.claimToken, "private held text"]) {
      assert(!output.includes(secret), "credential/body must not reach audit logs");
    }
  } finally {
    h.close();
  }
});

async function setup(aiFetch?: (url: string) => Response) {
  const h = await harness({
    env: aiFetch ? { AI_SEARCH_API_KEY: "k" } : {},
    fetch: aiFetch,
  });
  const rfp = await h.db.rfps.insert({
    title: "Community initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: "0xD5Cf05f24727C83976652E3586c0e26DD39884e9",
    proposer: PROPOSER,
  });
  h.script.badgeHolders.add(EXPERT.toLowerCase());
  // DONOR has $25 confirmed on this initiative
  const tx = "0x" + "aa".repeat(32);
  h.script.receipts[tx] = {
    status: "0x1",
    blockNumber: "0x10",
    logs: [transferLog(TOKENS.USDC[0], DONOR, rfp.safeAddress, 25_000_000n)],
  };
  await h.req("/api/donate/confirm", {
    method: "POST",
    json: { slug: rfp.slug, txHash: tx },
  });
  const post = (token: string | undefined, body: Record<string, unknown>) =>
    h.req(`/api/initiatives/${rfp.slug}/comments`, {
      method: "POST",
      token,
      json: { body: "Why?", ...body },
    });
  return { h, rfp, post };
}

Deno.test("comments: anonymous needs a name; without AI, anon posts are held with a private claim token", async () => {
  const { h, rfp, post } = await setup();
  assertEquals((await post(undefined, {})).status, 400);
  assertEquals((await post(undefined, { name: "x", type: "rant" })).status, 400);
  assertEquals((await post(undefined, { name: "x", body: "" })).status, 400);
  assertEquals((await post(undefined, { name: "x", email: "not-an-email" })).status, 400);
  const hp = await j(await post(undefined, { name: "x", website: "spam" }));
  assertEquals(hp, { status: "published", id: "", claimToken: "" });
  const held = await j(await post(undefined, { name: "Anon" })) as {
    status: string;
    id: string;
    claimToken: string;
  };
  assertEquals(held.status, "held");
  assertEquals(held.claimToken.length, 32);
  const list = await j(await h.req(`/api/initiatives/${rfp.slug}/comments`)) as {
    entries: unknown[];
  };
  assertEquals(list.entries.length, 0);
  const mine = await j(
    await h.req("/api/comments/mine", { method: "POST", json: { tokens: [held.claimToken] } }),
  ) as {
    held: { id: string }[];
  };
  assertEquals(mine.held.map((x) => x.id), [held.id]);
  const admin = await h.mint(ADMIN, true);
  const dash = await j(await h.req("/api/admin/dashboard", { token: admin })) as {
    held: unknown[];
    bell: number;
  };
  assertEquals(dash.held.length, 1);
  assertEquals(dash.bell, 1);
  await h.req(`/api/admin/comments/${held.id}/publish`, { method: "POST", token: admin });
  const list2 = await j(await h.req(`/api/initiatives/${rfp.slug}/comments`)) as {
    entries: { displayName: string; roles: string[]; votes: number }[];
  };
  assertEquals(list2.entries[0].displayName, "Anon");
  assertEquals(list2.entries[0].votes, 0);
  assertEquals(
    (await j(
      await h.req("/api/comments/mine", { method: "POST", json: { tokens: [held.claimToken] } }),
    ) as {
      held: unknown[];
    }).held.length,
    0,
  );
  h.close();
});

Deno.test("new comments are generic and cannot collect categories, topics or email", async () => {
  const { h, rfp, post } = await setup();
  try {
    const admin = await h.mint(ADMIN, true);
    for (
      const retired of [
        { type: "question" },
        { type: "suggestion" },
        { topic: "budget" },
        { email: "person@example.org" },
      ]
    ) {
      assertEquals((await post(admin, retired)).status, 400);
    }
    assertEquals(await h.db.comments.forRfp(rfp.id), []);
    // Current requests and the previous browser's harmless defaults both work.
    for (const body of [{}, { type: "other", topic: "", email: "" }]) {
      const response = await post(admin, body);
      assertEquals(response.status, 200);
      const { id } = await j(response) as { id: string };
      const row = (await h.db.comments.get(id))!;
      assertEquals([row.type, row.topic, row.email], ["other", "", ""]);
    }
  } finally {
    h.close();
  }
});

Deno.test("AI screen: constructive publishes, unclear holds, spam discards but looks held, failure holds", async () => {
  let verdict = "constructive";
  let fail = false;
  const { post, h } = await setup((url) => {
    if (!url.includes("/chat/completions")) return new Response("", { status: 404 });
    if (fail) return new Response("boom", { status: 500 });
    return Response.json({
      choices: [{
        message: { content: JSON.stringify({ verdict, summary: "ok", name_flag: "ok" }) },
      }],
    });
  });
  assertEquals((await j(await post(undefined, { name: "A" }))).status, "published");
  verdict = "unclear";
  assertEquals((await j(await post(undefined, { name: "B" }))).status, "held");
  verdict = "spam";
  const spam = await j(await post(undefined, { name: "C" }));
  assertEquals(spam, { status: "held", id: "", claimToken: "" });
  assertEquals((await h.db.comments.held()).length, 1); // the spam one was never stored
  fail = true;
  h.clock.now += 3601; // anonymous posts are capped at 3/hour/IP
  assertEquals((await j(await post(undefined, { name: "D" }))).status, "held");
  h.close();
});

Deno.test("roles: fast lane, starting vote, eligibility, replies, ordering, featured cap", async () => {
  const { h, rfp, post } = await setup();
  const curator = await h.mint(CURATOR);
  const expert = await h.mint(EXPERT);
  const donor = await h.mint(DONOR);
  const plain = await h.mint(PLAIN);
  const admin = await h.mint(ADMIN, true);

  const c1 = await j(await post(curator, { body: "curator q" })) as {
    status: string;
    id: string;
    entry: { roles: string[]; votes: number; myvote: number };
  };
  assertEquals(c1.status, "published");
  assertEquals(c1.entry.roles, ["CURATOR"]);
  assertEquals(c1.entry.votes, 1);
  assertEquals(c1.entry.myvote, 1);
  const e1 = await j(await post(expert, { body: "expert q" })) as {
    id: string;
    entry: { roles: string[] };
  };
  assertEquals(e1.entry.roles, ["EXPERT"]);
  // The wallet that proposed this initiative is tagged, skips moderation and can vote.
  const proposer = await h.mint(PROPOSER);
  const pr = await j(await post(proposer, { body: "proposer q" })) as {
    status: string;
    entry: { roles: string[]; votes: number };
  };
  assertEquals(pr.status, "published");
  assertEquals(pr.entry.roles, ["PROPOSER"]);
  assertEquals(pr.entry.votes, 1);
  const d1 = await j(await post(donor, { body: "donor q" })) as {
    status: string;
    id: string;
    claimToken: string;
  };
  assertEquals(d1.status, "held"); // no AI configured -> held, but starts with a vote once published
  await h.req(`/api/admin/comments/${d1.id}/publish`, { method: "POST", token: admin });
  const p1 = await j(await post(plain, { body: "plain q" })) as {
    status: string;
    id: string;
  };
  assertEquals(p1.status, "held");
  await h.req(`/api/admin/comments/${p1.id}/publish`, { method: "POST", token: admin });

  // votes
  assertEquals(
    (await h.req(`/api/comments/${c1.id}/vote`, { method: "POST", json: { dir: "up" } }))
      .status,
    401,
  );
  assertEquals(
    (await h.req(`/api/comments/${c1.id}/vote`, {
      method: "POST",
      token: plain,
      json: { dir: "up" },
    })).status,
    403,
  );
  assertEquals(
    (await h.req(`/api/comments/${c1.id}/vote`, {
      method: "POST",
      token: donor,
      json: { dir: "sideways" },
    })).status,
    400,
  );
  assertEquals(
    await j(
      await h.req(`/api/comments/${c1.id}/vote`, {
        method: "POST",
        token: donor,
        json: { dir: "up" },
      }),
    ),
    { myvote: 1, votes: 2 },
  );
  assertEquals(
    await j(
      await h.req(`/api/comments/${c1.id}/vote`, {
        method: "POST",
        token: donor,
        json: { dir: "down" },
      }),
    ),
    { myvote: -1, votes: 0 },
  );
  assertEquals(
    await j(
      await h.req(`/api/comments/${c1.id}/vote`, {
        method: "POST",
        token: admin,
        json: { dir: "up" },
      }),
    ),
    { myvote: 1, votes: 1 },
  );
  const asDonor = await j(
    await h.req(`/api/initiatives/${rfp.slug}/comments`, { token: donor }),
  ) as {
    viewerCanVote: boolean;
    viewerRoles: string[];
    entries: { id: string; myvote: number }[];
  };
  assert(asDonor.viewerCanVote);
  assertEquals(asDonor.viewerRoles, ["DONOR"]);
  assertEquals(asDonor.entries.find((e) => e.id === c1.id)!.myvote, -1);
  const asPlain = await j(
    await h.req(`/api/initiatives/${rfp.slug}/comments`, { token: plain }),
  ) as { viewerCanVote: boolean };
  assertEquals(asPlain.viewerCanVote, false);

  // Historical question/suggestion rows still support replies and review.
  await h.db.kv.set(K.comment(rfp.id, c1.id), {
    ...(await h.db.comments.get(c1.id))!,
    type: "question",
    topic: "scope",
  });
  await h.db.kv.set(K.comment(rfp.id, e1.id), {
    ...(await h.db.comments.get(e1.id))!,
    type: "suggestion",
  });
  // replies: any signed-in wallet; without a role they are screened (held here,
  // there is no AI) and do not answer the question. Roles publish at once.
  assertEquals(
    (await h.req(`/api/comments/${c1.id}/reply`, { method: "POST", json: { body: "me too" } }))
      .status,
    400, // a name is required without a wallet
  );
  const anonReply = await j(
    await h.req(`/api/comments/${c1.id}/reply`, {
      method: "POST",
      json: { body: "anon reply", name: "Anon" },
    }),
  ) as { status: string; claimToken: string };
  assertEquals(anonReply.status, "held");
  assertEquals(anonReply.claimToken.length, 32);
  const mineHeld = await j(
    await h.req("/api/comments/mine", { method: "POST", json: { tokens: [anonReply.claimToken] } }),
  ) as {
    held: { parentId: string | null }[];
  };
  assertEquals(mineHeld.held.map((x) => x.parentId), [c1.id]);
  const plainReply = await j(
    await h.req(`/api/comments/${c1.id}/reply`, {
      method: "POST",
      token: plain,
      json: { body: "me too" },
    }),
  ) as { ok: boolean; status: string; reply: unknown; claimToken: string; answered: boolean };
  assertEquals(plainReply.status, "held");
  assertEquals(plainReply.reply, null);
  assertEquals(plainReply.claimToken.length, 32);
  assertEquals(plainReply.answered, false);
  assertEquals((await h.db.comments.get(c1.id))!.answered, false);
  const heldReply = (await h.db.comments.held()).find((x) => x.address === PLAIN)!;
  assertEquals(heldReply.parentId, c1.id);
  const rep = await j(
    await h.req(`/api/comments/${c1.id}/reply`, {
      method: "POST",
      token: admin,
      json: { body: "answer" },
    }),
  ) as { reply: { roles: string[] } };
  assertEquals(rep.reply.roles, ["ADMIN"]);
  assertEquals((await h.db.comments.get(c1.id))!.answered, true);
  assertEquals(
    (await h.req(`/api/comments/${c1.id}/reply`, {
      method: "POST",
      token: expert,
      json: { body: "expert view" },
    })).status,
    200,
  );
  const withReplies = await j(await h.req(`/api/initiatives/${rfp.slug}/comments`)) as {
    entries: { id: string; replies: unknown[]; answered: boolean }[];
  };
  const top = withReplies.entries.find((e) => e.id === c1.id)!;
  assertEquals(top.replies.length, 2);
  assert(top.answered);
  await h.req(`/api/admin/comments/${heldReply.id}/publish`, { method: "POST", token: admin });
  const published = await j(await h.req(`/api/initiatives/${rfp.slug}/comments`)) as {
    entries: { id: string; replies: unknown[] }[];
  };
  assertEquals(published.entries.find((e) => e.id === c1.id)!.replies.length, 3);

  // report never hides
  await h.req(`/api/comments/${c1.id}/report`, { method: "POST" });
  assertEquals((await h.db.comments.get(c1.id))!.reports, 1);
  assertEquals(
    ((await j(await h.req(`/api/initiatives/${rfp.slug}/comments`))).entries as unknown[])
      .length,
    5,
  );
  // admin dismisses the reports; the entry stays published
  assertEquals(
    (await h.req(`/api/admin/comments/${c1.id}/unreport`, { method: "POST", token: admin }))
      .status,
    200,
  );
  assertEquals((await h.db.comments.get(c1.id))!.reports, 0);
  assertEquals((await h.db.comments.reported()).length, 0);

  // Acceptance was removed even for historical suggestions; review still works.
  assertEquals(
    (await h.req(`/api/admin/comments/${c1.id}/accept`, { method: "POST", token: admin }))
      .status,
    400,
  );
  assertEquals(
    (await h.req(`/api/admin/comments/${e1.id}/accept`, { method: "POST", token: admin })).status,
    400,
  );
  assertEquals((await h.db.comments.get(e1.id))!.accepted, false);
  assertEquals((await h.db.comments.get(e1.id))!.reviewed, false);
  assertEquals(
    (await h.req(`/api/admin/comments/${e1.id}/review`, { method: "POST", token: admin })).status,
    200,
  );
  assertEquals((await h.db.comments.get(e1.id))!.reviewed, true);
  // feature-front max 3
  const ids = (await h.db.comments.forRfp(rfp.id)).filter((c) => !c.parentId).map((c) => c.id);
  for (const id of ids.slice(0, 3)) {
    assertEquals(
      (await h.req(`/api/admin/comments/${id}/feature-front`, {
        method: "POST",
        token: admin,
      })).status,
      200,
    );
  }
  const fourth = await h.req(`/api/admin/comments/${ids[3]}/feature-front`, {
    method: "POST",
    token: admin,
  });
  assertEquals(fourth.status, 409);
  assertStringIncludes(String((await j(fourth)).error), "3 featured");
  const board = await j(await h.req("/api/board")) as {
    community: { initiative: { slug: string } }[];
  };
  assertEquals(board.community.length, 3);
  assertEquals(board.community[0].initiative.slug, rfp.slug);
  await h.req(`/api/admin/comments/${ids[0]}/unfeature`, {
    method: "POST",
    token: admin,
  });
  assertEquals(((await j(await h.req("/api/board"))).community as unknown[]).length, 2);
  h.close();
});

Deno.test("two-tier ordering: featured (newest featured first), then votes, then newest", () => {
  const e = (
    id: string,
    featured: number,
    featuredAt: number,
    votes: number,
    createdAt: number,
  ) => ({ id, featured, featuredAt, votes, createdAt });
  const sorted = sortEntries([
    e("old-feat", 1, 100, 0, 1),
    e("hot", 0, 0, 9, 2),
    e("new-feat", 1, 200, 0, 3),
    e("newer-same-votes", 0, 0, 9, 4),
    e("cold", 0, 0, -2, 5),
  ]).map((x) => x.id);
  assertEquals(sorted, ["new-feat", "old-feat", "newer-same-votes", "hot", "cold"]);
});

Deno.test("names: .eth is only allowed as the poster's own ENS name", async () => {
  const h = await harness({
    fetch: (url) => {
      if (url.startsWith("https://api.ensdata.net/griff.eth")) {
        return Response.json({ address: ADMIN });
      }
      return Response.json({});
    },
  });
  const rfp = await h.db.rfps.insert({
    title: "Named initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: "0xD5Cf05f24727C83976652E3586c0e26DD39884e9",
  });
  const post = (token: string | undefined, body: Record<string, unknown>) =>
    h.req(`/api/initiatives/${rfp.slug}/comments`, {
      method: "POST",
      token,
      json: { body: "Why?", ...body },
    });
  const admin = await h.mint(ADMIN, true);
  const plain = await h.mint(PLAIN);

  // plain names are untouched (first: anonymous posts are rate limited per IP)
  assertEquals((await post(undefined, { name: "Ethel" })).status, 200);
  // anonymous: never
  assertEquals((await post(undefined, { name: "griff.eth" })).status, 400);
  assertEquals((await post(undefined, { name: "Griff.ETH" })).status, 400);
  assertEquals((await post(undefined, { name: "nobody.eth" })).status, 400);
  // signed in: only the wallet the name points to
  assertEquals((await post(plain, { name: "griff.eth" })).status, 403);
  assertEquals((await post(plain, { name: "nobody.eth" })).status, 403);
  const ok = await j(await post(admin, { name: "griff.eth" })) as { status: string; id: string };
  assertEquals(ok.status, "published");

  // replies follow the same rule
  const reply = (token: string | undefined, name: string) =>
    h.req(`/api/comments/${ok.id}/reply`, { method: "POST", token, json: { body: "hi", name } });
  assertEquals((await reply(undefined, "griff.eth")).status, 400);
  assertEquals((await reply(plain, "griff.eth")).status, 403);
  assertEquals((await reply(admin, "griff.eth")).status, 200);

  // and so does the profile nickname, even with a space that hides the domain shape
  assertEquals(
    (await h.req("/api/nickname", {
      method: "POST",
      token: plain,
      json: { nickname: "griff.eth" },
    }))
      .status,
    403,
  );
  assertEquals(
    (await h.req("/api/nickname", {
      method: "POST",
      token: plain,
      json: { nickname: "not me.eth" },
    }))
      .status,
    403,
  );
  h.close();
});
