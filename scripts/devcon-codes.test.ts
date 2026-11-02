import { assertEquals, assertMatch } from "@std/assert";
import { privateKeyToAccount } from "viem/accounts";
import { verifyCode } from "../shared/devcon/code.ts";
import { codesPdf, signCodes } from "./devcon-codes.ts";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

Deno.test("signCodes: each URL carries a code the issuer's address verifies", async () => {
  const codes = await signCodes(KEY, 1, 3, "https://x.test/");
  assertEquals(codes.map((c) => c.n), [1, 2, 3]);
  const issuer = privateKeyToAccount(KEY).address;
  for (const c of codes) {
    assertMatch(c.url, /^https:\/\/x\.test\/devcon\/\d+\.[A-Za-z0-9_-]+$/);
    assertEquals(await verifyCode(c.url.split("/devcon/")[1], issuer), c.n);
  }
});

Deno.test("signCodes: a later batch continues the numbering", async () => {
  const codes = await signCodes(KEY, 201, 202, "https://x.test");
  assertEquals(codes.map((c) => c.n), [201, 202]);
});

Deno.test("codesPdf: 20 codes per A4 page", async () => {
  const codes = await signCodes(KEY, 1, 21, "https://x.test");
  const pdf = await codesPdf(codes);
  const { PDFDocument } = await import("npm:pdf-lib@1.17.1");
  const doc = await PDFDocument.load(pdf);
  assertEquals(doc.getPageCount(), 2);
});
