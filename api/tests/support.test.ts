import { assertEquals, assertStringIncludes } from "@std/assert";
import { harness, j } from "./app-helpers.ts";

const UPSTREAM = "https://support.example.test/inbox";

function setup(opts: { url?: string; upstream?: (init?: RequestInit) => Response } = {}) {
  return harness({
    env: opts.url === undefined ? {} : { SUPPORT_URL: opts.url },
    fetch: (_url, init) => (opts.upstream ?? (() => new Response("ok")))(init),
  });
}

const good = {
  category: "problem",
  email: "me@example.com",
  message: "The donate button does nothing.",
  page: "/initiative/foo",
};

Deno.test("support: 503 until SUPPORT_URL is set", async () => {
  const h = await setup();
  const res = await h.req("/api/support", { method: "POST", json: good });
  assertEquals(res.status, 503);
  assertEquals(h.fetchLog.length, 0);
  h.close();
});

Deno.test("support: rejects an unknown category, an empty message and a bad email", async () => {
  const h = await setup({ url: UPSTREAM });
  const post = (patch: Record<string, unknown>) =>
    h.req("/api/support", { method: "POST", json: { ...good, ...patch } });
  assertEquals((await post({ category: "rant" })).status, 400);
  assertEquals((await post({ message: "  " })).status, 400);
  assertEquals((await post({ email: "not-an-email" })).status, 400);
  assertEquals((await post({ screenshot: "https://evil.test/x.jpg" })).status, 400);
  assertEquals(h.fetchLog.length, 0);
  h.close();
});

Deno.test("support: forwards the tagged message, page URL and screenshot upstream", async () => {
  const h = await setup({ url: UPSTREAM });
  const shot = "data:image/jpeg;base64,/9j/4AAQ";
  const res = await h.req("/api/support", {
    method: "POST",
    json: { ...good, screenshot: shot },
  });
  assertEquals(res.status, 200);
  assertEquals(await j(res), { ok: true });
  assertEquals(h.fetchLog.length, 1);
  assertEquals(h.fetchLog[0].url, UPSTREAM);
  const init = h.fetchLog[0].init!;
  assertEquals(init.method, "POST");
  const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
  assertEquals(sent.name, "");
  assertEquals(sent.email, "me@example.com");
  assertEquals(sent.screenshot, shot);
  const msg = sent.message as string;
  assertStringIncludes(msg, "[TheDAO Initiatives · Report a problem]");
  assertStringIncludes(msg, "Page: http://localhost:5173/initiative/foo");
  assertStringIncludes(msg, "The donate button does nothing.");
  h.close();
});

Deno.test("support: email and screenshot are optional; an off-site page is dropped", async () => {
  const h = await setup({ url: UPSTREAM });
  const res = await h.req("/api/support", {
    method: "POST",
    json: { category: "idea", message: "Add a dark mode", page: "https://evil.test/phish" },
  });
  assertEquals(res.status, 200);
  const sent = JSON.parse(String(h.fetchLog[0].init!.body)) as Record<string, unknown>;
  assertEquals(sent.email, "");
  assertEquals("screenshot" in sent, false);
  assertEquals((sent.message as string).includes("Page:"), false);
  h.close();
});

Deno.test("support: 502 when the upstream fails", async () => {
  const h = await setup({ url: UPSTREAM, upstream: () => new Response("nope", { status: 500 }) });
  const res = await h.req("/api/support", { method: "POST", json: good });
  assertEquals(res.status, 502);
  h.close();
});

Deno.test("support: 5 messages per hour per IP", async () => {
  const h = await setup({ url: UPSTREAM });
  for (let i = 0; i < 5; i++) {
    assertEquals((await h.req("/api/support", { method: "POST", json: good })).status, 200);
  }
  assertEquals((await h.req("/api/support", { method: "POST", json: good })).status, 429);
  assertEquals(h.fetchLog.length, 5);
  h.close();
});

Deno.test("support: the board's flags.support says whether the widget can show", async () => {
  const off = await setup();
  const offFlags = (await j(await off.req("/api/board")) as { flags: { support: boolean } }).flags;
  assertEquals(offFlags.support, false);
  off.close();
  const on = await setup({ url: UPSTREAM });
  const onFlags = (await j(await on.req("/api/board")) as { flags: { support: boolean } }).flags;
  assertEquals(onFlags.support, true);
  on.close();
});

Deno.test("support: a message past its cap is refused as too long, never cut", async () => {
  const h = await setup({ url: UPSTREAM });
  const res = await h.req("/api/support", {
    method: "POST",
    json: { ...good, message: "m".repeat(4001) },
  });
  assertEquals(res.status, 400);
  assertStringIncludes(
    String((await j(res)).error),
    "The message is too long (4,000 characters at most)",
  );
  assertEquals(h.fetchLog.length, 0);
  h.close();
});
