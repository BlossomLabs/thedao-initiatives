import { assertEquals } from "@std/assert";
import { AI_DAILY_CALL_CAP } from "../config.ts";
import { K } from "../db/keys.ts";
import { type Harness, harness, j } from "./app-helpers.ts";

const budgetKey = (h: Harness) =>
  K.aiBudget(new Date(h.clock.now * 1000).toISOString().slice(0, 10));
const spent = async (h: Harness) => (await h.kv.get<number>(budgetKey(h))).value ?? 0;
const search = (h: Harness, query = "verified compilers") =>
  h.req("/api/ai-search", { method: "POST", json: { query } });

async function board(h: Harness, count: number) {
  for (let i = 0; i < count; i++) {
    await h.db.initiatives.insert({ title: `Proposal ${i}`, status: "approved" });
  }
}

Deno.test("AI search budget: every Jev batch counts; cache hits and empty boards are free", async () => {
  let fail = false;
  let calls = 0;
  const h = await harness({
    env: { TYPESAFE_API_KEY: "test" },
    fetch: (_url, init) => {
      calls++;
      if (fail) return new Response("unavailable", { status: 503 });
      const body = JSON.parse(String(init?.body));
      return Response.json({
        answers: Object.fromEntries(
          Object.keys(body.questions).map((id) => [id, { type: "score", score: 2 }]),
        ),
      });
    },
  });
  try {
    assertEquals((await search(h)).status, 200);
    assertEquals([calls, await spent(h)], [0, 0]);
    await board(h, 60);
    assertEquals((await search(h)).status, 200);
    assertEquals([calls, await spent(h)], [3, 3]);
    assertEquals((await search(h)).status, 200);
    assertEquals([calls, await spent(h)], [3, 3]);

    await h.kv.set(budgetKey(h), AI_DAILY_CALL_CAP - 2);
    const refused = await search(h, "wallet security");
    assertEquals(refused.status, 429);
    assertEquals((await j(refused)).error, "search is resting until tomorrow");
    assertEquals([calls, await spent(h)], [3, AI_DAILY_CALL_CAP - 2]);

    await h.kv.set(budgetKey(h), AI_DAILY_CALL_CAP - 3);
    fail = true;
    assertEquals((await search(h, "wallet security")).status, 502);
    assertEquals([calls, await spent(h)], [6, AI_DAILY_CALL_CAP]);
    // A failed provider request is charged and never cached.
    assertEquals((await search(h, "wallet security")).status, 429);
    assertEquals(calls, 6);
    // An already cached ranking remains available after exhaustion.
    assertEquals((await search(h)).status, 200);
    assertEquals(calls, 6);
  } finally {
    h.close();
  }
});

Deno.test("AI search budget: LLM fallback attempts each need a reservation", async () => {
  for (const remaining of [1, 2]) {
    let calls = 0;
    const h = await harness({
      env: { TYPESAFE_ENABLED: "false", AI_SEARCH_API_KEY: "test" },
      fetch: (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        if (body.response_format) {
          return new Response("response_format unsupported", { status: 400 });
        }
        const { proposals } = JSON.parse(body.messages[1].content);
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify({
                scores: Object.fromEntries(proposals.map((p: { id: string }) => [p.id, 0.5])),
              }),
            },
          }],
        });
      },
    });
    try {
      await board(h, 26);
      await h.kv.set(budgetKey(h), AI_DAILY_CALL_CAP - remaining);
      assertEquals((await search(h)).status, remaining === 1 ? 429 : 200);
      assertEquals(calls, remaining);
      assertEquals(await spent(h), AI_DAILY_CALL_CAP);
    } finally {
      h.close();
    }
  }
});

Deno.test("AI budget: concurrent reservations cannot overspend and a new day resets the cap", async () => {
  const h = await harness();
  try {
    await h.kv.set(budgetKey(h), AI_DAILY_CALL_CAP - 3);
    const admitted = await Promise.all(Array.from({ length: 20 }, () => h.db.meta.aiBudgetOk(3)));
    assertEquals(admitted.filter(Boolean).length, 1);
    assertEquals(await spent(h), AI_DAILY_CALL_CAP);
    assertEquals(await h.db.meta.aiBudgetOk(), false);
    h.clock.now += 86400;
    assertEquals(await h.db.meta.aiBudgetOk(3), true);
    assertEquals(await spent(h), 3);
    for (const invalid of [0, -1, 0.5, NaN, Infinity, AI_DAILY_CALL_CAP + 1]) {
      assertEquals(await h.db.meta.aiBudgetOk(invalid), false);
    }
    assertEquals(await spent(h), 3);
  } finally {
    h.close();
  }
});

Deno.test("AI search: a Jev error says its status, and a 402 that it wants paying", async () => {
  let status = 402;
  const h = await harness({
    env: { TYPESAFE_API_KEY: "test" },
    fetch: () => new Response("<html>no credits</html>", { status }),
  });
  try {
    await board(h, 1);
    const unpaid = await search(h);
    assertEquals(unpaid.status, 502);
    assertEquals(
      (await j(unpaid)).error,
      "search is unavailable right now (Jev HTTP 402: payment required)",
    );
    status = 503;
    const down = await search(h, "wallet security");
    assertEquals((await j(down)).error, "search is unavailable right now (Jev HTTP 503)");
  } finally {
    h.close();
  }
});
