import { assertEquals } from "@std/assert";
import { formatTable, percentile, runBench } from "../scripts/bench.ts";

Deno.test("bench: percentile interpolates over sorted samples", () => {
  assertEquals(percentile([50, 10, 30, 20, 40], 50), 30);
  assertEquals(percentile([50, 10, 30, 20, 40], 95), 48);
  assertEquals(percentile([7], 50), 7);
  assertEquals(percentile([], 50), 0);
});

Deno.test("bench: runBench samples each path and reports wire bytes", async () => {
  const calls: string[] = [];
  const fakeFetch = ((url: string, init?: RequestInit) => {
    calls.push(url);
    assertEquals(new Headers(init?.headers).get("accept-encoding"), "gzip");
    const body = url.endsWith("/api/board") ? "x".repeat(2048) : "ok";
    return Promise.resolve(
      new Response(body, { headers: { "content-length": String(body.length) } }),
    );
  }) as typeof fetch;
  const rows = await runBench("https://example.test/", ["/healthz", "/api/board"], 3, fakeFetch);
  assertEquals(calls.length, 6);
  assertEquals(calls[0], "https://example.test/healthz");
  assertEquals(rows.map((r) => r.path), ["/healthz", "/api/board"]);
  assertEquals(rows[1].bytes, 2048);
  assertEquals(rows[0].samples, 3);
  const table = formatTable(rows);
  assertEquals(table.split("\n")[0].startsWith("path"), true);
  assertEquals(table.includes("/api/board"), true);
});
