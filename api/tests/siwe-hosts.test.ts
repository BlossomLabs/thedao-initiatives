import { assertEquals } from "@std/assert";
import { harness, j, testConnection } from "./app-helpers.ts";
import { wallet } from "./helpers.ts";

Deno.test("SIWE: platform request hosts cannot augment either authentication allowlist", async () => {
  const w = wallet("11".repeat(32));
  const cases: {
    host: string;
    env: Record<string, string>;
    domain: string;
    uri: string;
    error: string;
  }[] = [
    {
      host: "phish.deno.net",
      env: {},
      domain: "phish.deno.net",
      uri: "https://phish.deno.net",
      error: "domain not allowed",
    },
    {
      host: "phish.deno.dev",
      env: {},
      domain: "phish.deno.dev",
      uri: "https://phish.deno.dev",
      error: "domain not allowed",
    },
    {
      host: "phish.deno.net",
      env: {},
      domain: "localhost:5173",
      uri: "https://phish.deno.net",
      error: "uri not allowed",
    },
    {
      host: "preview.deno.net",
      env: { WEB_ORIGIN: "https://preview.deno.net", SIWE_DOMAINS: "localhost:5173" },
      domain: "preview.deno.net",
      uri: "https://preview.deno.net",
      error: "domain not allowed",
    },
    {
      host: "phish.example",
      env: { SELF_HOST_SUFFIXES: ".example" },
      domain: "phish.example",
      uri: "https://phish.example",
      error: "domain not allowed",
    },
  ];
  for (const c of cases) {
    const h = await harness({ env: c.env });
    try {
      const nonce = await h.db.sessions.issueNonce();
      const message =
        `${c.domain} wants you to sign in with your Ethereum account:\n${w.address}\n\n` +
        `Sign in to TheDAO Security Fund\n\nURI: ${c.uri}\nVersion: 1\nChain ID: 1\n` +
        `Nonce: ${nonce}\nIssued At: ${new Date(h.clock.now * 1000).toISOString()}`;
      const signature = await w.sign(message);
      for (const origin of [undefined, `https://${c.host}`]) {
        const res = await h.app.request(`https://${c.host}/api/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
          body: JSON.stringify({ message, signature }),
        }, testConnection());
        assertEquals(res.status, 401);
        assertEquals((await j(res)).error, c.error);
        assertEquals(res.headers.get("set-cookie"), null);
      }
      // Rejected relying parties never consume the challenge.
      assertEquals(await h.db.sessions.consumeNonce(nonce), true);
    } finally {
      h.close();
    }
  }
});
