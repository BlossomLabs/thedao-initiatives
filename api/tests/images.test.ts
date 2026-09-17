import { assert, assertEquals, assertFalse } from "@std/assert";
import { normalizeImage } from "../lib/image.ts";
import { JPEG, PNG, PNG_TOO_MANY_PIXELS, PNG_TOO_WIDE, WEBP } from "./image-fixtures.ts";
import { harness } from "./app-helpers.ts";

Deno.test("uploads decode and re-encode all supported formats and strip metadata/appended bytes", async () => {
  for (const [bytes, ext] of [[PNG, "png"], [JPEG, "jpg"], [WEBP, "webp"]] as const) {
    const clean = await normalizeImage(bytes);
    assert(clean, ext);
    assertEquals(clean.ext, ext);
    assertFalse(new TextDecoder().decode(clean.bytes).includes("private-test-metadata"));
    assert(await normalizeImage(clean.bytes), "output must decode again");
  }
  const appended = new Uint8Array([
    ...PNG,
    ...new TextEncoder().encode("UNTRUSTED-APPENDED-CONTENT"),
  ]);
  const clean = await normalizeImage(appended);
  if (clean) {
    assertFalse(new TextDecoder().decode(clean.bytes).includes("UNTRUSTED-APPENDED-CONTENT"));
  }
});

Deno.test("invalid, truncated, unsupported and oversized-dimension images never reach the upload provider", async () => {
  const h = await harness({ env: { PINATA_JWT: "fixture" } });
  try {
    for (
      const bytes of [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        PNG.slice(0, 40),
        JPEG.slice(0, 30),
        WEBP.slice(0, 18),
        PNG_TOO_WIDE,
        PNG_TOO_MANY_PIXELS,
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      ]
    ) {
      const [cid, err] = await h.deps.pinata.uploadImage(bytes, 1_048_576, "test");
      assertEquals(cid, null);
      assert(err);
    }
    assertFalse(h.fetchLog.some((x) => x.url.includes("pinata.cloud")));
  } finally {
    h.close();
  }
});
