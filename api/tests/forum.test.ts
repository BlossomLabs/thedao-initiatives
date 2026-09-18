import { assertEquals, assertStringIncludes } from "@std/assert";
import { harness, j, proposerToken } from "./app-helpers.ts";
import { minimalSubmission } from "./fixtures.ts";

// These links exercise the old title fallback through the public route. Even
// a resolver that approves the initial hostname must never lead to an HTTP
// request, whether the form is rejected or the link is stored successfully.
const discussionLinks = [
  "https://forum.example.com//127.0.0.1:8443/admin",
  "https://forum.example.com///169.254.169.254/latest/meta-data",
  "https://forum.example.com//[::1]:8443/admin",
  "https://forum.example.com/\\127.0.0.1:8443/admin",
  "https://127.0.0.1:8443/admin",
  "https://10.0.0.1/admin",
  "https://[::1]/admin",
  "https://[::ffff:127.0.0.1]/admin",
  "https://forum.example.com/redirect-to-private",
  "https://rebind.example.com/t/topic/123",
];

for (const discourseUrl of discussionLinks) {
  Deno.test(`submit never fetches a discussion URL: ${discourseUrl}`, async () => {
    const h = await harness({
      fetch: () => Response.json({ title: "Attacker-controlled topic title" }),
    });
    try {
      const resolved: string[] = [];
      h.deps.resolve = (host) => {
        resolved.push(host);
        // Model a DNS change after the link-validation lookup. There must
        // be no later resolution/connection to obtain a topic title.
        return Promise.resolve(
          resolved.length === 1
            ? [["93.184.216.34"], null]
            : [null, "host resolves to a non-public address"],
        );
      };
      const token = await proposerToken(h);
      const blankTitle = await h.req("/api/initiatives", {
        method: "POST",
        token,
        json: { ...minimalSubmission(1000), title: "", discourseUrl },
      });
      assertEquals(blankTitle.status, 400);
      assertEquals(h.fetchLog, []);
      assertEquals((await h.db.initiatives.list(["pending"])).length, 0);

      // The original exploit used an incomplete form, which must also
      // remain incapable of triggering any outbound HTTP request.
      resolved.length = 0;
      const incomplete = await h.req("/api/initiatives", {
        method: "POST",
        token,
        json: { discourseUrl },
      });
      assertEquals(incomplete.status, 400);
      assertEquals(h.fetchLog, []);

      resolved.length = 0;
      const explicitTitle = await h.req("/api/initiatives", {
        method: "POST",
        token,
        json: { ...minimalSubmission(1000), discourseUrl },
      });
      // IPv6 literal links are rejected by the existing URL validator;
      // accepted URLs are inert stored links, including authority tricks.
      const ipv6Literal = new URL(discourseUrl).hostname.startsWith("[");
      assertEquals(explicitTitle.status, ipv6Literal ? 400 : 201);
      if (!ipv6Literal) {
        const { slug } = await j(explicitTitle) as { slug: string };
        const row = (await h.db.initiatives.bySlug(slug))!;
        assertEquals(row.title, minimalSubmission(1000).title);
        assertEquals(row.discourseUrl, new URL(discourseUrl).toString());
        assertEquals(resolved, [new URL(discourseUrl).hostname]);
      }
      assertEquals(h.fetchLog, []);
    } finally {
      h.close();
    }
  });
}

Deno.test("submit: a private DNS result rejects a discussion link without fetching it", async () => {
  const h = await harness();
  try {
    h.deps.resolve = () => Promise.resolve([null, "host resolves to a non-public address"]);
    const token = await proposerToken(h);
    const response = await h.req("/api/initiatives", {
      method: "POST",
      token,
      json: { ...minimalSubmission(1000), discourseUrl: "https://private.example.com/t/topic/123" },
    });
    assertEquals(response.status, 400);
    assertStringIncludes(String((await j(response)).error), "not reachable");
    assertEquals(h.fetchLog, []);
  } finally {
    h.close();
  }
});
