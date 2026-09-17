import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "../config.ts";

const base = { WEB_ORIGIN: "https://initiatives.test", ADMIN_ADDRESSES: "" };

Deno.test("rate limit mode: enforce by default, RATE_LIMIT_MODE selects observe or off", () => {
  assertEquals(loadConfig(base).rateLimitMode, "enforce");
  assertEquals(loadConfig({ ...base, RATE_LIMIT_MODE: "enforce" }).rateLimitMode, "enforce");
  assertEquals(loadConfig({ ...base, RATE_LIMIT_MODE: " Observe " }).rateLimitMode, "observe");
  assertEquals(loadConfig({ ...base, RATE_LIMIT_MODE: "off" }).rateLimitMode, "off");
});

Deno.test("rate limit mode: the retired DISABLE_RATE_LIMITS variable is ignored", () => {
  assertEquals(loadConfig({ ...base, DISABLE_RATE_LIMITS: "true" }).rateLimitMode, "enforce");
});

Deno.test("rate limit mode: a misspelt mode stops the app instead of silently enforcing", () => {
  assertThrows(() => loadConfig({ ...base, RATE_LIMIT_MODE: "observ" }), Error, "RATE_LIMIT_MODE");
});

// ------------------------------------------------------------------ limiter

import { assert, assertFalse, assertMatch } from "@std/assert";
import { rateLimiter } from "../db/ratelimit.ts";
import { sha256Hex } from "../lib/ids.ts";

async function limiter(opts: Parameters<typeof rateLimiter>[2] = {}) {
  const kv = await Deno.openKv(":memory:");
  const clock = { now: 1_800_000_000 };
  const lines: string[] = [];
  const events = () => lines.map((l) => JSON.parse(l));
  const limit = rateLimiter(kv, () => clock.now, { log: (l) => lines.push(l), ...opts });
  const counted = async () => {
    const keys = [];
    for await (const e of kv.list({ prefix: ["rl"] })) keys.push(e.key);
    return keys.length;
  };
  return { kv, clock, lines, events, limit, counted, close: () => kv.close() };
}

Deno.test("rate limiter: observe mode counts, allows past the cap and logs the breach once per window", async () => {
  const l = await limiter({ mode: "observe" });
  try {
    for (let i = 0; i < 3; i++) assert(await l.limit("nonce:203.0.113.42", 2, 60));
    assertEquals(l.events().length, 1);
    const breach = l.events()[0];
    assertEquals(breach.rateLimit, true);
    assertEquals(breach.event, "ratelimit.breach");
    assertEquals(breach.bucket, "nonce");
    assertEquals(breach.key, sha256Hex("203.0.113.42"));
    assertEquals(breach.cap, 2);
    assertEquals(breach.window, 60);
    assertEquals(breach.count, 3);
    assertEquals(breach.mode, "observe");
    assertEquals(breach.enforced, false);
    assertEquals(breach.at, "2027-01-15T08:00:00.000Z");
    assertFalse(l.lines[0].includes("203.0.113.42"), "raw client key must not reach the log");
    // the 4th..19th hits stay quiet; 20 (10x the cap) is reported again, then 40
    for (let i = 4; i <= 40; i++) assert(await l.limit("nonce:203.0.113.42", 2, 60));
    assertEquals(l.events().map((e) => e.count), [3, 20, 40]);
    // a new window starts clean and reports its own first crossing
    l.clock.now += 60;
    for (let i = 0; i < 3; i++) assert(await l.limit("nonce:203.0.113.42", 2, 60));
    assertEquals(l.events().map((e) => e.count), [3, 20, 40, 3]);
  } finally {
    l.close();
  }
});

Deno.test("rate limiter: enforce mode refuses past the cap and logs the breach as enforced", async () => {
  const l = await limiter({ mode: "enforce" });
  try {
    assert(await l.limit("login-global", 1, 60));
    assertFalse(await l.limit("login-global", 1, 60));
    assertFalse(await l.limit("login-global", 1, 60));
    assertEquals(l.events().length, 1);
    assertEquals(l.events()[0].bucket, "login-global");
    assertEquals("key" in l.events()[0], false);
    assertEquals(l.events()[0].enforced, true);
    assertEquals(l.events()[0].mode, "enforce");
  } finally {
    l.close();
  }
});

Deno.test("rate limiter: off mode neither counts nor logs", async () => {
  const l = await limiter({ mode: "off" });
  try {
    for (let i = 0; i < 5; i++) assert(await l.limit("submit:203.0.113.42", 1, 60));
    assertEquals(await l.counted(), 0);
    assertEquals(l.lines, []);
  } finally {
    l.close();
  }
});

Deno.test("rate limiter: observe mode still refuses buckets listed as always enforced", async () => {
  const l = await limiter({ mode: "observe", alwaysEnforce: ["submit:", "support:"] });
  try {
    assert(await l.limit("submit:203.0.113.42", 1, 3600));
    assertFalse(await l.limit("submit:203.0.113.42", 1, 3600));
    assert(await l.limit("submitter:203.0.113.42", 1, 3600));
    assert(await l.limit("submitter:203.0.113.42", 1, 3600)); // prefix match includes the colon
    assertEquals(l.events().map((e) => [e.bucket, e.enforced]), [["submit", true], [
      "submitter",
      false,
    ]]);
  } finally {
    l.close();
  }
});

Deno.test("rate limiter: the default mode is enforce and a missing logger is fine", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const limit = rateLimiter(kv, () => 1_800_000_000);
    assert(await limit("x", 1, 60));
    assertFalse(await limit("x", 1, 60));
  } finally {
    kv.close();
  }
});

Deno.test("rate limiter: the breach line is one JSON object with a stable shape", async () => {
  const l = await limiter({ mode: "observe" });
  try {
    await l.limit("cpost:addr:0xAbC", 0, 60);
    assertMatch(l.lines[0], /^\{"rateLimit":true,/);
    assertEquals(Object.keys(l.events()[0]).sort(), [
      "at",
      "bucket",
      "cap",
      "count",
      "enforced",
      "event",
      "key",
      "mode",
      "rateLimit",
      "schema",
      "window",
    ]);
    assertEquals(l.events()[0].key, sha256Hex("addr:0xAbC"));
  } finally {
    l.close();
  }
});

// ------------------------------------------------------------------ routes

import { harness, proposerToken, testConnection } from "./app-helpers.ts";
import { minimalSubmission } from "./fixtures.ts";
import { ALWAYS_ENFORCED_RATE_LIMITS } from "../config.ts";
import { formatLogLine } from "../bootstrap.ts";

async function observing() {
  const h = await harness({ env: { RATE_LIMIT_MODE: "observe" } });
  const lines: string[] = [];
  h.deps.log = (line) => lines.push(line);
  const breaches = () =>
    lines.filter((l) => l.startsWith('{"rateLimit":true,')).map((l) => JSON.parse(l));
  return { ...h, lines, breaches };
}

Deno.test("RATE_LIMIT_MODE=observe: a public quota past its cap is reported through the app logger, not refused", async () => {
  const h = await observing();
  try {
    for (let i = 0; i < 31; i++) {
      assertEquals((await h.app.request("/api/auth/nonce", {}, testConnection())).status, 200);
    }
    const [breach] = h.breaches();
    assertEquals(h.breaches().length, 1);
    assertEquals(breach.bucket, "nonce");
    assertEquals(breach.count, 31);
    assertEquals(breach.enforced, false);
    assertEquals(breach.key, sha256Hex("203.0.113.42"));
    assertFalse(h.lines.some((l) => l.includes("203.0.113.42")));
  } finally {
    h.close();
  }
});

Deno.test("RATE_LIMIT_MODE=observe: submissions, support and uploads keep their caps", async () => {
  assertEquals([...ALWAYS_ENFORCED_RATE_LIMITS].sort(), [
    "logoup:",
    "pfpup:",
    "submit:",
    "support:",
  ]);
  const h = await observing();
  try {
    const token = await proposerToken(h);
    const submit = (i: number) =>
      h.req("/api/initiatives", {
        method: "POST",
        token,
        json: {
          ...minimalSubmission(25_000 + i * 1_000),
          title: `Initiative number ${i} of the session`,
          summary: `Submission ${i} from a room that shares one IP address during a live session.`,
        },
      });
    for (let i = 0; i < 5; i++) assertEquals((await submit(i)).status, 201);
    assertEquals((await submit(5)).status, 429);
    assertEquals(h.breaches().map((b) => [b.bucket, b.enforced]), [["submit", true]]);
  } finally {
    h.close();
  }
});

Deno.test("RATE_LIMIT_MODE=off: nothing is counted or reported", async () => {
  const h = await harness({ env: { RATE_LIMIT_MODE: "off" } });
  const lines: string[] = [];
  h.deps.log = (line) => lines.push(line);
  try {
    for (let i = 0; i < 31; i++) {
      assertEquals((await h.app.request("/api/auth/nonce", {}, testConnection())).status, 200);
    }
    const quotas = [];
    for await (const entry of h.kv.list({ prefix: ["rl"] })) quotas.push(entry);
    assertEquals(quotas, []);
    assertEquals(lines.filter((l) => l.startsWith('{"rateLimit":true,')), []);
  } finally {
    h.close();
  }
});

Deno.test("bootstrap log: structured JSON lines reach the console unprefixed, plain text is timestamped", () => {
  const at = new Date("2027-01-15T08:00:00.000Z");
  assertEquals(formatLogLine('{"rateLimit":true,"x":1}', at), '{"rateLimit":true,"x":1}');
  assertEquals(formatLogLine('{"securityAudit":true,"x":1}', at), '{"securityAudit":true,"x":1}');
  assertEquals(formatLogLine("kv ready", at), "[2027-01-15T08:00:00.000Z] kv ready");
});
