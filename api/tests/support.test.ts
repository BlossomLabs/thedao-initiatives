import { assertEquals, assertStringIncludes } from "@std/assert";
import { harness, j, SAFE_ADDR } from "./app-helpers.ts";
import { SUPPORT_TRANSACTION_URL_MAX } from "../../shared/support.ts";
import { AI_SUPPORT_DAILY_CALL_CAP } from "../config.ts";

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

const pledge = {
  category: "pledge",
  pledgeAmount: " $25,000.50 ",
  pledgeOrg: " Acme ",
  email: " donor@example.com ",
  pledgeContact: " Alex ",
  message: "We would like to fund this work.",
  page: "/",
};

Deno.test("support: pledge requests forward current initiative facts and every contact field", async () => {
  const h = await setup({ url: UPSTREAM });
  try {
    for (const type of ["grant", "rfp"] as const) {
      const safeAddress = type === "grant" ? SAFE_ADDR : "0x" + "22".repeat(20);
      const initiative = await h.db.initiatives.insert({
        title: `Security work ${type}`,
        type,
        status: "approved",
        goalUsd: 100000,
        safeAddress,
      });
      await h.db.initiatives.revise(initiative.id, {
        title: `Updated security work ${type}`,
        summary: "",
        details: "",
      }, { author: "admin", source: "admin" });
      const res = await h.req("/api/support", {
        method: "POST",
        json: { ...pledge, initiativeId: initiative.id },
      });
      assertEquals(res.status, 200);
      const call = h.fetchLog.at(-1)!;
      assertEquals(call.url, UPSTREAM);
      const sent = JSON.parse(String(call.init!.body));
      assertEquals(sent.name, "Alex");
      assertEquals(sent.email, "donor@example.com");
      for (
        const line of [
          "[TheDAO Initiatives · Pledge to an Initiative]",
          `Title: Updated security work ${type}`,
          `Link: http://localhost:5173/initiative/${initiative.slug}`,
          `Type: ${type === "grant" ? "Grant" : "RFP"}`,
          "Funding Goal: $100,000.00",
          `Safe Address: ${safeAddress}`,
          "Pledge Amount: $25,000.50",
          "Pledge Org: Acme",
          "Pledge Contact Email: donor@example.com",
          "Who are we talking with?: Alex",
          "Message: We would like to fund this work.",
        ]
      ) assertStringIncludes(sent.message, line);
      assertEquals(await h.db.pledges.list(initiative.id), []);
    }
    assertEquals(h.fetchLog.length, 2);
  } finally {
    h.close();
  }
});

Deno.test("support: invalid or unpublished pledge requests never reach the relay", async () => {
  const h = await setup({ url: UPSTREAM });
  try {
    const initiative = await h.db.initiatives.insert({ title: "Published", status: "approved" });
    for (
      const patch of [
        { initiativeId: undefined },
        { initiativeId: "missing" },
        { pledgeAmount: undefined },
        { pledgeAmount: "0" },
        { pledgeAmount: "-5" },
        { pledgeAmount: "1e6" },
        { pledgeAmount: "1.001" },
        { pledgeAmount: 100000001 },
        { pledgeAmount: { amount: 5000 } },
        { pledgeOrg: " " },
        { pledgeOrg: "x".repeat(161) },
        { pledgeContact: undefined },
        { pledgeContact: "x".repeat(121) },
        { email: "" },
        { email: "bad-email" },
        { email: "x".repeat(200) + "@example.com" },
        { message: " " },
        { transactionUrl: "https://etherscan.io/tx/123" },
        { title: "Spoofed initiative metadata" },
      ]
    ) {
      const res = await h.req("/api/support", {
        method: "POST",
        json: { ...pledge, initiativeId: initiative.id, ...patch },
      });
      assertEquals(res.status, 400, JSON.stringify(patch));
    }
    for (const status of ["pending", "rejected", "archived"] as const) {
      const hidden = await h.db.initiatives.insert({ title: status, status });
      const res = await h.req("/api/support", {
        method: "POST",
        json: { ...pledge, initiativeId: hidden.id },
      });
      assertEquals(res.status, 400);
    }
    const other = await h.req("/api/support", {
      method: "POST",
      json: { ...good, initiativeId: initiative.id, pledgeAmount: 5000 },
    });
    assertEquals(other.status, 400);
    assertEquals(h.fetchLog.length, 0);
  } finally {
    h.close();
  }
});

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

Deno.test("support: receipt requests forward the email and transaction through the existing relay", async () => {
  const h = await setup({ url: UPSTREAM });
  const transactionUrl = `https://etherscan.io/tx/0x${"ab".repeat(32)}`;
  try {
    for (const message of [undefined, "Please use my organisation's name on the receipt."]) {
      const res = await h.req("/api/support", {
        method: "POST",
        json: {
          category: "receipt",
          email: " donor@example.com ",
          transactionUrl: ` ${transactionUrl} `,
          page: "/initiative/foo",
          ...(message ? { message } : {}),
        },
      });
      assertEquals(res.status, 200);
      assertEquals(await j(res), { ok: true });
      const call = h.fetchLog.at(-1)!;
      assertEquals(call.url, UPSTREAM);
      const sent = JSON.parse(String(call.init!.body));
      assertEquals(sent, {
        name: "",
        email: "donor@example.com",
        message: "[TheDAO Initiatives · Request a donation receipt]\n" +
          `Transaction: ${transactionUrl}\n` +
          "Page: http://localhost:5173/initiative/foo\n\n" +
          (message ?? "Please send a receipt for this donation."),
      });
    }
    // Transaction links are forwarded, never fetched.
    assertEquals(h.fetchLog.length, 2);
  } finally {
    h.close();
  }
});

Deno.test("support: receipt requests require a valid email and an https transaction link", async () => {
  const h = await setup({ url: UPSTREAM });
  const receipt = {
    category: "receipt",
    email: "donor@example.com",
    transactionUrl: `https://etherscan.io/tx/0x${"ab".repeat(32)}`,
  };
  try {
    for (
      const patch of [
        { email: undefined },
        { email: " " },
        { email: "not-an-email" },
        { email: "a".repeat(200) + "@example.com" },
        { transactionUrl: undefined },
        { transactionUrl: " " },
        { transactionUrl: "not-a-url" },
        { transactionUrl: "http://etherscan.io/tx/123" },
        { transactionUrl: "javascript:alert(1)" },
        { transactionUrl: "https://user:password@etherscan.io/tx/123" },
        { transactionUrl: "https://etherscan.io/tx/123\nspoofed-line" },
        { transactionUrl: "https://etherscan.io/" + "x".repeat(SUPPORT_TRANSACTION_URL_MAX) },
      ]
    ) {
      const res = await h.req("/api/support", {
        method: "POST",
        json: { ...receipt, ...patch },
      });
      assertEquals(res.status, 400, JSON.stringify(patch));
    }
    for (const category of ["constructor", "toString", "__proto__"]) {
      const res = await h.req("/api/support", {
        method: "POST",
        json: { ...receipt, category },
      });
      assertEquals(res.status, 400);
    }
    assertEquals(h.fetchLog.length, 0);
  } finally {
    h.close();
  }
});

Deno.test("support: other categories reject receipt fields instead of dropping them", async () => {
  const h = await setup({ url: UPSTREAM });
  try {
    const res = await h.req("/api/support", {
      method: "POST",
      json: { ...good, transactionUrl: "https://etherscan.io/tx/123" },
    });
    assertEquals(res.status, 400);
    assertEquals(h.fetchLog.length, 0);
  } finally {
    h.close();
  }
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

/** A board with an AI key whose screen answers `reply`, and the support relay. */
function screened(reply: () => Response) {
  return harness({
    env: { SUPPORT_URL: UPSTREAM, AI_SEARCH_API_KEY: "k" },
    fetch: (url) => url.includes("/chat/completions") ? reply() : new Response("ok"),
  });
}
const verdict = (v: string, summary: string) => () =>
  Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: v, summary }) } }] });
const sentMessage = (h: { fetchLog: { url: string; init?: RequestInit }[] }) =>
  JSON.parse(String(h.fetchLog.find((x) => x.url === UPSTREAM)!.init!.body)).message as string;

Deno.test("support: spam is tagged SPAM and still sent, with unknown link domains named", async () => {
  const h = await screened(verdict("spam", "Crypto airdrop advert."));
  const res = await h.req("/api/support", {
    method: "POST",
    json: { ...good, message: "Claim now https://airdrop.example/x and https://github.com/a/b" },
  });
  assertEquals(res.status, 200);
  const msg = sentMessage(h);
  assertStringIncludes(msg, "[TheDAO Initiatives · Report a problem · SPAM]\n");
  assertStringIncludes(msg, "AI screen: SPAM: Crypto airdrop advert.");
  assertStringIncludes(msg, "Unknown link domains: airdrop.example\n");
  assertStringIncludes(msg, "Claim now https://airdrop.example/x");
  h.close();
});

Deno.test("support: a genuine message gets its line and no SPAM tag", async () => {
  const h = await screened(verdict("genuine", "Donate button bug."));
  assertEquals((await h.req("/api/support", { method: "POST", json: good })).status, 200);
  const msg = sentMessage(h);
  assertStringIncludes(
    msg,
    "[TheDAO Initiatives · Report a problem]\nAI screen: Genuine: Donate button bug.",
  );
  assertEquals(msg.includes("SPAM"), false);
  assertEquals(msg.includes("Unknown link domains"), false);
  h.close();
});

Deno.test("support: a failed screen still sends the message, with the reason", async () => {
  const h = await screened(() => new Response("down", { status: 503 }));
  assertEquals((await h.req("/api/support", { method: "POST", json: good })).status, 200);
  const msg = sentMessage(h);
  assertStringIncludes(msg, "AI screen failed: provider HTTP 503");
  assertStringIncludes(msg, "The donate button does nothing.");
  // One call, no retry: anyone can send these.
  assertEquals(h.fetchLog.filter((x) => x.url.includes("/chat/completions")).length, 1);
  h.close();
});

Deno.test("support: its own share of the AI budget, so comment moderation keeps the rest", async () => {
  const h = await screened(verdict("genuine", "ok"));
  for (let i = 0; i < AI_SUPPORT_DAILY_CALL_CAP; i++) {
    assertEquals(await h.db.meta.aiSupportBudgetOk(), true);
  }
  assertEquals(await h.db.meta.aiSupportBudgetOk(), false);
  // Each support call also counted against the shared cap, which still has room.
  assertEquals(await h.db.meta.aiBudgetOk(), true);
  assertEquals((await h.req("/api/support", { method: "POST", json: good })).status, 200);
  assertStringIncludes(sentMessage(h), "AI screen failed: daily budget used up");
  h.close();
});
