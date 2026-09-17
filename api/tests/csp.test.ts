import { assertEquals, assertFalse } from "@std/assert";
import { ADMIN, harness } from "./app-helpers.ts";
Deno.test("CSP reports are bounded and redacted, and do not refresh sessions", async () => {
  const h = await harness();
  try {
    const logs: string[] = [];
    h.deps.log = (s) => logs.push(s);
    const token = await h.mint(ADMIN, true);
    h.db.sessions.get = () => {
      throw new Error("must not read a session for telemetry");
    };
    const report = {
      "csp-report": {
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://private.example/SECRET?token=SECRET",
        "script-sample": "SECRET",
        "document-uri": "https://site/private/SECRET",
      },
    };
    const res = await h.req("/api/csp-report", { method: "POST", token, json: report });
    assertEquals(res.status, 204);
    const entries = logs.filter((s) => s.includes('"securityCsp":true'));
    assertEquals(entries.length, 1);
    assertEquals(JSON.parse(entries[0]).resource, "external");
    assertFalse(logs.join().includes("SECRET"));
    assertEquals(
      (await h.req("/api/csp-report", { method: "POST", json: { value: "x".repeat(17000) } }))
        .status,
      413,
    );
    for (let n = 1; n < 20; n++) await h.req("/api/csp-report", { method: "POST", json: report });
    assertEquals((await h.req("/api/csp-report", { method: "POST", json: report })).status, 429);
  } finally {
    h.close();
  }
});
