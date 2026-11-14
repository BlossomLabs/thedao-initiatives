/** The moderation queue: an AI screen that explains itself, a re-run, and
 * what the board knows about who wrote a held comment (#88). */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADMIN, harness, j, PLAIN } from "./app-helpers.ts";
import { transferLog } from "./helpers.ts";
import { TOKENS } from "../config.ts";
import { parseJsonObject } from "../services/ai.ts";

type Reply = (body: Record<string, unknown>) => Response;
const said = (out: Record<string, unknown>): Response =>
  Response.json({ choices: [{ message: { content: JSON.stringify(out) } }] });
const constructive = () => said({ verdict: "constructive", summary: "fine", name_flag: "ok" });

/** A board with one approved initiative and an AI provider the test drives. */
async function setup(reply: Reply = constructive) {
  const calls: Record<string, unknown>[] = [];
  const h = await harness({
    env: { AI_SEARCH_API_KEY: "k" },
    fetch: (url, init) => {
      if (!url.includes("/chat/completions")) return new Response("", { status: 404 });
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(body);
      return reply(body);
    },
  });
  const initiative = await h.db.initiatives.insert({
    title: "Community initiative",
    status: "approved",
    goalUsd: 1000,
    safeAddress: "0xD5Cf05f24727C83976652E3586c0e26DD39884e9",
    proposer: ADMIN,
  });
  const post = async (body: Record<string, unknown>) => {
    h.clock.now += 3601; // anonymous posts are capped at 3/hour/IP
    return await j(
      await h.req(`/api/initiatives/${initiative.slug}/comments`, {
        method: "POST",
        json: { name: "Anon", body: "Why?", ...body },
      }),
    ) as { status: string; id: string };
  };
  return { h, initiative, post, calls };
}

Deno.test("AI screen: a provider that refuses response_format is asked again without it, once", async () => {
  const { h, post, calls } = await setup((body) =>
    body.response_format
      ? Response.json({
        error: { message: "structured output (response_format) is not supported" },
      }, { status: 400 })
      : constructive()
  );
  try {
    assertEquals((await post({})).status, "published");
    assertEquals(calls.map((c) => Boolean(c.response_format)), [true, false]);
    // The instance remembers: the next screen is one call, without it.
    assertEquals((await post({})).status, "published");
    assertEquals(calls.length, 3);
    assertEquals(calls[2].response_format, undefined);
  } finally {
    h.close();
  }
});

Deno.test("AI screen: a failure is retried once, then held with the reason", async () => {
  let failures = 1;
  const { h, post, calls } = await setup(() =>
    failures-- > 0 ? new Response("upstream down", { status: 503 }) : constructive()
  );
  try {
    assertEquals((await post({})).status, "published"); // the retry answered
    assertEquals(calls.length, 2);
    failures = 2;
    const held = await post({});
    assertEquals(held.status, "held");
    assertEquals(calls.length, 4); // two tries, no more
    const row = (await h.db.comments.get(held.id))!;
    assertEquals(row.aiScreen?.verdict, null);
    assertStringIncludes(row.aiScreen!.error, "provider HTTP 503");
    assertStringIncludes(row.aiScreen!.error, "upstream down");
    assertStringIncludes(row.aiSummary, "AI screen failed: provider HTTP 503");
    assert(!row.aiSummary.includes("AI screen error"));
  } finally {
    h.close();
  }
});

Deno.test("AI screen: bad JSON and invalid verdicts say so", async () => {
  let content = "not json at all";
  const { h, post } = await setup(() => Response.json({ choices: [{ message: { content } }] }));
  try {
    let row = (await h.db.comments.get((await post({})).id))!;
    assertEquals(row.status, "held");
    assertStringIncludes(row.aiScreen!.error, "bad JSON");
    content = JSON.stringify({ verdict: "maybe", summary: "x" });
    row = (await h.db.comments.get((await post({})).id))!;
    assertStringIncludes(row.aiScreen!.error, 'invalid verdict: "maybe"');
    // A fenced reply is read.
    content = '```json\n{"verdict": "unclear", "summary": "asks why", "name_flag": "ok"}\n```';
    row = (await h.db.comments.get((await post({})).id))!;
    assertEquals([row.aiScreen!.verdict, row.aiScreen!.reason, row.aiSummary], [
      "unclear",
      "AI said unclear",
      "asks why",
    ]);
  } finally {
    h.close();
  }
});

Deno.test("parseJsonObject reads bare, fenced and wrapped objects and rejects the rest", () => {
  assertEquals(parseJsonObject('{"a":1}'), { a: 1 });
  assertEquals(parseJsonObject('Sure! {"a":1} done'), { a: 1 });
  for (const bad of ["", "[]", "nope", null]) {
    let threw = false;
    try {
      parseJsonObject(bad);
    } catch {
      threw = true;
    }
    assert(threw, String(bad));
  }
});

Deno.test("AI screen: spam on a link-only comment is held for a person, other spam is dropped", async () => {
  const { h, post } = await setup(() =>
    said({ verdict: "spam", summary: "a link", name_flag: "ok" })
  );
  try {
    const link = await post({ body: "https://example.com/airdrop" });
    assertEquals(link.status, "held");
    const row = (await h.db.comments.get(link.id))!;
    assertEquals(row.aiScreen?.verdict, "spam");
    assertStringIncludes(row.aiScreen!.reason, "it is a link");
    const words = await post({ body: "buy cheap tokens now, best prices in the whole world" });
    assertEquals(words, { status: "held", id: "", claimToken: "" } as never);
    assertEquals((await h.db.comments.held()).length, 1);
  } finally {
    h.close();
  }
});

Deno.test("re-run AI screen: held rows only, stores the new answer, never publishes", async () => {
  let up = false;
  const { h, post } = await setup(() => up ? constructive() : new Response("", { status: 500 }));
  try {
    const admin = await h.mint(ADMIN, true);
    const a = await post({});
    const b = await post({});
    up = true;
    const res = await h.req(`/api/admin/comments/${a.id}/rescreen`, {
      method: "POST",
      token: admin,
    });
    assertEquals(res.status, 200);
    const one = (await j(res)).comment as {
      status: string;
      aiScreen: { verdict: string; error: string };
    };
    assertEquals([one.status, one.aiScreen.verdict, one.aiScreen.error], [
      "held",
      "constructive",
      "",
    ]);
    const bulk = await j(
      await h.req("/api/admin/comments/bulk", {
        method: "POST",
        token: admin,
        json: { action: "rescreen", ids: [b.id, "missing"] },
      }),
    );
    assertEquals(bulk.done, 1);
    assertEquals((bulk.failed as { id: string }[]).map((f) => f.id), ["missing"]);
    assertEquals((await h.db.comments.get(b.id))?.status, "held");
    assertEquals((await h.db.comments.get(b.id))?.aiScreen?.verdict, "constructive");
    await h.req(`/api/admin/comments/${a.id}/publish`, { method: "POST", token: admin });
    assertEquals(
      (await h.req(`/api/admin/comments/${a.id}/rescreen`, { method: "POST", token: admin }))
        .status,
      400,
    );
    const many = Array.from({ length: 21 }, (_, i) => "id" + i);
    assertEquals(
      (await h.req("/api/admin/comments/bulk", {
        method: "POST",
        token: admin,
        json: { action: "rescreen", ids: many },
      })).status,
      400,
    );
  } finally {
    h.close();
  }
});

Deno.test("dashboard: a held reply shows its parent and what the board knows about the author", async () => {
  const { h, initiative } = await setup(() =>
    said({ verdict: "unclear", summary: "a link", name_flag: "ok" })
  );
  try {
    const admin = await h.mint(ADMIN, true);
    // PLAIN proposed another initiative, gave $25 to this one and holds the badge.
    await h.db.initiatives.insert({
      title: "Plain's own",
      status: "approved",
      goalUsd: 1000,
      safeAddress: "0x" + "12".repeat(20),
      proposer: PLAIN,
    });
    h.script.badgeHolders.add(PLAIN.toLowerCase());
    const tx = "0x" + "bb".repeat(32);
    h.script.receipts[tx] = {
      status: "0x1",
      blockNumber: "0x10",
      logs: [transferLog(TOKENS.USDC[0], PLAIN, initiative.safeAddress, 25_000_000n)],
    };
    await h.req("/api/donate/confirm", {
      method: "POST",
      json: { slug: initiative.slug, txHash: tx },
    });
    const parent = await h.db.comments.create({
      rfpId: initiative.id,
      parentId: null,
      type: "other",
      topic: "",
      body: "The parent comment",
      displayName: "Parent",
      email: "",
      address: "",
      roles: [],
      status: "published",
      aiSummary: "",
    });
    // A badge holder would skip the screen, so the held reply is written directly.
    const reply = await h.db.comments.create({
      rfpId: initiative.id,
      parentId: parent.id,
      type: "other",
      topic: "",
      body: "https://example.com/x",
      displayName: "",
      email: "",
      address: PLAIN,
      roles: [],
      status: "held",
      aiSummary: "",
    });
    await h.db.comments.create({
      rfpId: initiative.id,
      parentId: null,
      type: "other",
      topic: "",
      body: "an earlier one",
      displayName: "",
      email: "",
      address: PLAIN,
      roles: [],
      status: "discarded",
      aiSummary: "",
    });
    const dash = await j(await h.req("/api/admin/dashboard", { token: admin })) as {
      held: {
        id: string;
        context: {
          parent: { body: string } | null;
          author: {
            address: string;
            proposerOf: { title: string; here: boolean }[];
            backed: { title: string; usd: number; here: boolean }[];
            badge: boolean | null;
            comments: { published: number; held: number; discarded: number };
            firstSeen: number;
          } | null;
        };
      }[];
    };
    const row = dash.held.find((x) => x.id === reply.id)!;
    assertEquals(row.context.parent?.body, "The parent comment");
    const a = row.context.author!;
    assertEquals(a.address, PLAIN);
    assertEquals(a.proposerOf.map((p) => [p.title, p.here]), [["Plain's own", false]]);
    assertEquals(a.backed.map((b) => [b.title, b.usd, b.here]), [[
      "Community initiative",
      25,
      true,
    ]]);
    assertEquals(a.badge, true);
    assertEquals(a.comments, { published: 0, held: 1, discarded: 1 });
    assert(a.firstSeen <= reply.createdAt);
  } finally {
    h.close();
  }
});
