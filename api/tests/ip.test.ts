import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import type { Vars } from "../middleware/context.ts";
import { canonicalIp, clientIp } from "../middleware/ip.ts";
import { harness, j, testConnection } from "./app-helpers.ts";

Deno.test("client IP: canonical forms cannot create distinct quota identities", () => {
  const examples: [unknown, string | null][] = [
    ["203.0.113.42", "203.0.113.42"],
    // IPv6 clients usually own a whole /64, so the quota identity is the prefix.
    ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::/64"],
    ["2001:db8::ffff:ffff:ffff:ffff", "2001:db8::/64"],
    ["2001:db8:0:1::1", "2001:db8:0:1::/64"],
    ["2001:db8:abcd:ef01:2345:6789:abcd:ef01", "2001:db8:abcd:ef01::/64"],
    ["::ffff:203.0.113.42", "203.0.113.42"],
    ["0:0:0:0:0:ffff:cb00:712a", "203.0.113.42"],
    ["127.0.0.1", "127.0.0.1"],
    ["::1", "::/64"],
    [undefined, null],
    ["", null],
    ["unknown", null],
    ["203.000.113.42", null],
    ["2130706433", null],
    ["127.1", null],
    ["client.example", null],
    ["203.0.113.42:443", null],
    ["[2001:db8::1]", null],
    ["fe80::1%eth0", null],
    ["203.0.113.42,203.0.113.43", null],
  ];
  for (const [input, expected] of examples) {
    assertEquals(canonicalIp(input), expected, String(input));
  }
});

function attribution() {
  const app = new Hono<Vars>();
  app.use("*", clientIp());
  app.get("/", (c) => c.json({ ip: c.var.ip }));
  return app;
}

Deno.test("client IP: real server dispatch preserves distinct socket peers and ignores spoofed forwarding", async () => {
  const app = attribution();
  for (
    const [ip, identity] of [
      ["203.0.113.42", "203.0.113.42"],
      ["203.0.113.43", "203.0.113.43"],
      ["2001:db8::42", "2001:db8::/64"],
    ]
  ) {
    const response = await app.fetch(
      new Request("http://api.test/", {
        headers: {
          "X-Forwarded-For": "198.51.100.1",
          Forwarded: "for=198.51.100.2",
          "X-Real-IP": "198.51.100.3",
        },
      }),
      testConnection(ip),
    );
    assertEquals(await response.json(), { ip: identity });
  }
  assertEquals(await (await app.request("/")).json(), { ip: null });
});

Deno.test("client IP: missing identity fails IP-limited routes closed without consuming a shared quota", async () => {
  const h = await harness();
  try {
    const response = await h.app.request("/api/auth/nonce");
    assertEquals(response.status, 503);
    assertEquals(
      (await j(response)).error,
      "Client network identity is unavailable. Try again later.",
    );
    const quotas = [];
    for await (const entry of h.kv.list({ prefix: ["rl"] })) quotas.push(entry);
    assertEquals(quotas, []);
    assertEquals((await h.app.request("/healthz")).status, 200);
    assertEquals((await h.app.request("/api/board")).status, 200);
    // Disabling limits is not permission to invent a client identity.
    const disabled = await harness({ env: { RATE_LIMIT_MODE: "off" } });
    try {
      assertEquals((await disabled.app.request("/api/auth/nonce")).status, 503);
    } finally {
      disabled.close();
    }
  } finally {
    h.close();
  }
});

Deno.test("client IP: socket peers have independent quotas; IPv4-mapped aliases share one", async () => {
  const h = await harness();
  try {
    let forged = 0;
    const nonce = async (peer: string) =>
      await h.app.fetch(
        new Request("http://api.test/api/auth/nonce", {
          headers: { "X-Forwarded-For": `198.51.100.${++forged}` },
        }),
        testConnection(peer),
      );
    for (let i = 0; i < 30; i++) assertEquals((await nonce("203.0.113.42")).status, 200);
    assertEquals((await nonce("::ffff:203.0.113.42")).status, 429);
    assertEquals((await nonce("203.0.113.43")).status, 200);
    const quotaNames = [];
    for await (const entry of h.kv.list({ prefix: ["rl"] })) quotaNames.push(entry.key[1]);
    assertEquals(quotaNames.sort(), ["nonce:203.0.113.42", "nonce:203.0.113.43"]);
  } finally {
    h.close();
  }
});

Deno.test("client IP: global quotas remain effective when clients change addresses", async () => {
  const h = await harness();
  try {
    const start = Math.floor(h.clock.now / 60) * 60;
    await h.kv.set(["rl", "login-global", start], 60);
    for (const peer of ["203.0.113.42", "203.0.113.43"]) {
      const res = await h.app.fetch(
        new Request("http://api.test/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
        testConnection(peer),
      );
      assertEquals(res.status, 429);
    }
    assertEquals((await h.kv.get<number>(["rl", "login-global", start])).value, 62);
  } finally {
    h.close();
  }
});

Deno.test("client IP: IPv6 peers share one quota per /64 and get a fresh one per prefix", async () => {
  const h = await harness();
  try {
    const nonce = async (peer: string) =>
      await h.app.fetch(new Request("http://api.test/api/auth/nonce"), testConnection(peer));
    for (let i = 0; i < 30; i++) {
      assertEquals((await nonce(`2001:db8:1:2::${(i + 1).toString(16)}`)).status, 200);
    }
    assertEquals((await nonce("2001:db8:1:2:ffff:ffff:ffff:ffff")).status, 429);
    assertEquals((await nonce("2001:db8:1:3::1")).status, 200);
    const quotaNames = [];
    for await (const entry of h.kv.list({ prefix: ["rl"] })) quotaNames.push(entry.key[1]);
    assertEquals(quotaNames.sort(), ["nonce:2001:db8:1:2::/64", "nonce:2001:db8:1:3::/64"]);
  } finally {
    h.close();
  }
});
