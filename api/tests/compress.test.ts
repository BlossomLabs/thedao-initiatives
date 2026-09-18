import { assert, assertEquals } from "@std/assert";
import { harness } from "./app-helpers.ts";

async function gunzip(res: Response): Promise<string> {
  const stream = res.body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

Deno.test("api: JSON is gzipped when the client accepts it, unchanged otherwise", async () => {
  const h = await harness();
  for (let i = 0; i < 8; i++) {
    await h.db.rfps.insert({
      title: `Initiative ${i}`,
      summary: "s".repeat(300),
      status: "approved",
      goalUsd: 1000,
    });
  }
  const plain = await h.req("/api/board");
  assertEquals(plain.headers.get("content-encoding"), null);
  const body = await plain.text();

  const zipped = await h.req("/api/board", { headers: { "accept-encoding": "gzip, br" } });
  assertEquals(zipped.status, 200);
  assertEquals(zipped.headers.get("content-encoding"), "gzip");
  assert(/accept-encoding/i.test(zipped.headers.get("vary") ?? ""), "Vary: Accept-Encoding");
  assertEquals(zipped.headers.get("cache-control"), "no-store");
  assertEquals(
    zipped.headers.get("content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'",
  );
  assertEquals(await gunzip(zipped), body);
  h.close();
});
