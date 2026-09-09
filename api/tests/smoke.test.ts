import { assertEquals } from "@std/assert";
import { harness, j } from "./app-helpers.ts";

Deno.test("healthz verifies tokens through the scripted rpc", async () => {
  const h = await harness();
  const res = await h.req("/healthz");
  assertEquals(res.status, 200);
  const body = await j(res);
  assertEquals(body.ok, true);
  assertEquals((body.tokensOk as string[]).length, 9);
  h.close();
});
