import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, CURATOR, harness, j, PLAIN } from "./app-helpers.ts";
import { sortEntries } from "../routes/comments.ts";
import { TOKENS } from "../config.ts";
import { transferLog } from "./helpers.ts";

const EXPERT = "0x3333333333333333333333333333333333333333";
const DONOR = "0x4444444444444444444444444444444444444444";

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
      json: { type: "question", topic: "scope", body: "Why?", ...body },
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
  const mine = await j(await h.req("/api/comments/mine?tokens=" + held.claimToken)) as {
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
    (await j(await h.req("/api/comments/mine?tokens=" + held.claimToken)) as {
      held: unknown[];
    }).held.length,
    0,
  );
  h.close();
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
  const e1 = await j(await post(expert, { body: "expert q", type: "suggestion" })) as {
    entry: { roles: string[] };
  };
  assertEquals(e1.entry.roles, ["EXPERT"]);
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

  // replies: role-only; admin reply answers a question
  assertEquals(
    (await h.req(`/api/comments/${c1.id}/reply`, {
      method: "POST",
      token: plain,
      json: { body: "me too" },
    })).status,
    403,
  );
  assertEquals(
    (await h.req(`/api/comments/${c1.id}/reply`, {
      method: "POST",
      token: donor,
      json: { body: "me too" },
    })).status,
    403,
  );
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

  // report never hides
  await h.req(`/api/comments/${c1.id}/report`, { method: "POST" });
  assertEquals((await h.db.comments.get(c1.id))!.reports, 1);
  assertEquals(
    ((await j(await h.req(`/api/initiatives/${rfp.slug}/comments`))).entries as unknown[])
      .length,
    4,
  );

  // admin actions: accept only suggestions; feature-front max 3
  assertEquals(
    (await h.req(`/api/admin/comments/${c1.id}/accept`, { method: "POST", token: admin }))
      .status,
    400,
  );
  assertEquals(
    (await h.req(
      `/api/admin/comments/${
        e1.entry
          ? (await h.db.comments.forRfp(rfp.id)).find((c) => c.type === "suggestion")!.id
          : ""
      }/accept`,
      { method: "POST", token: admin },
    )).status,
    200,
  );
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
