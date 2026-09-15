import { assertEquals } from "@std/assert";
import { selfOrigin } from "../lib/origin.ts";
import { loadConfig } from "../config.ts";

Deno.test("selfOrigin: platform hosts only; X-Forwarded-Proto only when the proxy is trusted", () => {
  const cfg = loadConfig({});
  const trusting = loadConfig({ TRUST_PROXY: "1" });
  const plain = new Request("https://fund-abc.deno.net/api/x");
  assertEquals(selfOrigin(plain, cfg), "https://fund-abc.deno.net");
  const proxied = new Request("http://fund-abc.deno.net/api/x", {
    headers: { "x-forwarded-proto": "https" },
  });
  assertEquals(selfOrigin(proxied, cfg), "http://fund-abc.deno.net");
  assertEquals(selfOrigin(proxied, trusting), "https://fund-abc.deno.net");
  const junk = new Request("http://x.deno.dev/", { headers: { "x-forwarded-proto": "gopher" } });
  assertEquals(selfOrigin(junk, trusting), "http://x.deno.dev");
  // An arbitrary Host header buys nothing.
  assertEquals(selfOrigin(new Request("https://evil.example/api/x"), cfg), null);
  assertEquals(selfOrigin(new Request("https://deno.net.evil.example/"), cfg), null);
  const custom = loadConfig({ SELF_HOST_SUFFIXES: ".thedao.fund" });
  assertEquals(
    selfOrigin(new Request("https://fund.thedao.fund/"), custom),
    "https://fund.thedao.fund",
  );
  assertEquals(selfOrigin(new Request("https://x.deno.net/"), custom), null);
});

Deno.test("config: WEB_ORIGIN entries are normalized to bare origins (trailing slash, path, case)", () => {
  const cfg = loadConfig({
    WEB_ORIGIN: "https://initiatives.thedao.fund/, HTTPS://Fund.TheDAO.fund/board , http://localhost:5173",
  });
  assertEquals(cfg.webOrigins, [
    "https://initiatives.thedao.fund",
    "https://fund.thedao.fund",
    "http://localhost:5173",
  ]);
  assertEquals(cfg.siweDomains, ["initiatives.thedao.fund", "fund.thedao.fund", "localhost:5173"]);
});

Deno.test("config: WEB_ORIGIN falls back to VITE_SITE_URL's origin, then localhost", () => {
  const fromSite = loadConfig({ VITE_SITE_URL: "https://fund.thedao.fund/" });
  assertEquals(fromSite.webOrigins, ["https://fund.thedao.fund"]);
  assertEquals(fromSite.siweDomains, ["fund.thedao.fund"]);
  const explicit = loadConfig({
    VITE_SITE_URL: "https://fund.thedao.fund",
    WEB_ORIGIN: "http://localhost:5173",
  });
  assertEquals(explicit.webOrigins, ["http://localhost:5173"]);
  assertEquals(loadConfig({}).webOrigins, ["http://localhost:5173"]);
});
