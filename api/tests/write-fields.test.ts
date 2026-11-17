/** Strict write contracts: typos cannot silently succeed or partially apply a request. */
import { assert, assertEquals } from "@std/assert";
import { ADMIN, harness, j, PLAIN, proposerToken, SAFE_ADDR } from "./app-helpers.ts";
import { minimalSubmission, revisionBody, syntheticContentFiles } from "./fixtures.ts";

const UNKNOWN = "unexpectedField";
const TX = "0x" + "12".repeat(32);

async function setup() {
  const h = await harness({
    env: {
      RATE_LIMIT_MODE: "off",
      PINATA_JWT: "test",
      AI_SEARCH_API_KEY: "test",
      SUPPORT_URL: "https://support.example/",
    },
  });
  const admin = await h.mint(ADMIN, true);
  const proposer = await proposerToken(h);
  const draft = minimalSubmission(1000);
  const row = await h.db.initiatives.insert({
    ...revisionBody(draft),
    goalUsd: 1000,
    proposer: PLAIN,
    status: "approved",
    safeAddress: SAFE_ADDR,
  });
  const comment = await h.db.comments.create({
    rfpId: row.id,
    parentId: null,
    type: "other",
    topic: "",
    body: "Existing comment",
    displayName: "Admin",
    email: "",
    address: ADMIN,
    roles: [],
    status: "published",
    aiSummary: "",
  });
  const pledge = await h.db.pledges.add(row.id, {
    company: "Existing backer",
    amountUsd: 100,
    url: "",
    note: "",
    logoCid: "",
    status: "pledged",
  });
  return {
    h,
    admin,
    proposer,
    draft,
    row,
    comment,
    pledge,
    base: `/api/admin/initiatives/${row.id}`,
  };
}

async function rejected(res: Response, field = UNKNOWN, context = "") {
  const body = await j(res);
  assertEquals(res.status, 400, `${context}: ${JSON.stringify(body)}`);
  assertEquals(body.error, `Unsupported field: ${field}.`, context);
}

Deno.test("writes: every JSON endpoint rejects unknown fields before changing domain data", async () => {
  const { h, admin, proposer, draft, row, comment, pledge, base } = await setup();
  try {
    const session = (await h.db.sessions.list(ADMIN, admin))[0];
    const profile = await h.db.profiles.get(ADMIN);
    const admins = await h.deps.admins.list();
    const cases: [string, string, Record<string, unknown>][] = [
      ["POST", "/api/auth/verify", { message: "message", signature: "signature" }],
      ["POST", "/api/auth/cookie", {}],
      ["POST", "/api/auth/logout", {}],
      ["POST", "/api/auth/logout-all", {}],
      ["DELETE", `/api/auth/sessions/${session.id}`, {}],
      ["POST", "/api/nickname", { nickname: "New nickname" }],
      ["POST", "/api/pfp", { pfp: "preset:1" }],
      ["POST", "/api/ai-search", { query: "security" }],
      ["POST", "/api/support", { category: "bug", message: "Help" }],
      ["POST", "/api/initiatives", draft],
      ["PATCH", `/api/initiatives/${row.slug}`, { initiativeId: row.id, goal: "2000" }],
      ["POST", `/api/initiatives/${row.slug}/revisions`, {
        ...revisionBody(draft),
        title: "Changed title here",
      }],
      ["POST", `/api/initiatives/${row.slug}/comments`, { body: "New comment", name: "Name" }],
      ["POST", `/api/comments/${comment.id}/vote`, { dir: "up" }],
      ["POST", `/api/comments/${comment.id}/reply`, { body: "New reply", name: "Name" }],
      ["POST", `/api/comments/${comment.id}/report`, {}],
      ["POST", "/api/donate/confirm", { slug: row.slug, txHash: TX }],
      ["POST", "/api/admin/sessions/revoke", { address: PLAIN }],
      ["POST", "/api/admin/sessions/revoke-all", { confirmation: "revoke all sessions" }],
      ["POST", "/api/admin/admins", { address: PLAIN }],
      ["DELETE", `/api/admin/admins/${PLAIN}`, {}],
      ["PATCH", base, { sortRank: "1" }],
      ["POST", `${base}/revisions/1`, { action: "archive" }],
      ["POST", `${base}/status`, { action: "reject" }],
      ["POST", "/api/admin/initiatives/bulk", { ids: [row.id], action: "reject" }],
      ["POST", `${base}/pledges`, { company: "New backer", amount: 500 }],
      ["PATCH", `${base}/pledges/${pledge.id}`, { amount: 500 }],
      ["DELETE", `${base}/pledges/${pledge.id}`, {}],
      ["POST", `${base}/donations/recheck`, { txHash: TX }],
      ["POST", `${base}/sync-donations`, {}],
      ["POST", `${base}/safe-confirm`, {}],
      ["POST", "/api/admin/comments/bulk", { ids: [comment.id], action: "discard" }],
      ["POST", `/api/admin/comments/${comment.id}/discard`, {}],
      ["POST", "/api/admin/sync-content", { files: syntheticContentFiles() }],
      ["POST", "/api/admin/audit/test", {}],
    ];
    for (const [method, path, json] of cases) {
      await rejected(
        await h.req(path, { method, token: admin, json: { ...json, [UNKNOWN]: true } }),
        UNKNOWN,
        `${method} ${path}`,
      );
    }
    assertEquals(await h.db.initiatives.get(row.id), row);
    assertEquals(
      (await h.db.initiatives.list(["pending", "approved", "rejected", "archived"])).length,
      1,
    );
    assertEquals((await h.db.revisions.list(row.id)).length, 1);
    assertEquals(await h.db.comments.forInitiative(row.id), [comment]);
    assertEquals(await h.db.pledges.list(row.id), [pledge]);
    assertEquals(await h.db.profiles.get(ADMIN), profile);
    assertEquals(await h.deps.admins.list(), admins);
    assert(await h.db.sessions.get(admin, false));
    assert(await h.db.sessions.get(proposer, false));
    assertEquals(h.fetchLog, []);
    assertEquals(h.script.calls, []);
  } finally {
    h.close();
  }
});

Deno.test("writes: unknown multipart text and file fields are rejected before uploads", async () => {
  const { h, admin, row, pledge, base } = await setup();
  try {
    const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
      type: "image/png",
    });
    const cases = [
      ["POST", "/api/uploads/logo", "image"],
      ["POST", "/api/pfp/upload", "image"],
      ["POST", "/api/admin/logos", "image"],
      ["POST", `${base}/pledges`, "logo"],
      ["PATCH", `${base}/pledges/${pledge.id}`, "logo"],
    ];
    const profile = await h.db.profiles.get(ADMIN);
    for (const [method, path, imageField] of cases) {
      for (const extra of ["typo", image]) {
        const form = new FormData();
        form.set(imageField, image, "logo.png");
        if (path === "/api/admin/logos") form.set("name", "logo.png");
        if (imageField === "logo") {
          form.set("company", "New backer");
          form.set("amount", "500");
        }
        form.set(UNKNOWN, extra);
        await rejected(await h.req(path, { method, token: admin, body: form }), UNKNOWN, path);
      }
    }
    assertEquals(await h.db.pledges.list(row.id), [pledge]);
    assertEquals(await h.db.profiles.get(ADMIN), profile);
    assertEquals(await h.db.logos.get("logo.png"), null);
    assertEquals(h.fetchLog, []);
  } finally {
    h.close();
  }
});

Deno.test("writes: unknown nested fields reject the entire request, including bulk content sync", async () => {
  const { h, admin, proposer, draft, row } = await setup();
  try {
    const nested: [Record<string, unknown>, string][] = [
      [{ sections: { ...draft.sections, typo: "An answer that would be lost" } }, "sections.typo"],
      [{ milestones: [{ ...draft.milestones[0], amout: 1000 }] }, "milestones[0].amout"],
    ];
    for (const [extra, field] of nested) {
      await rejected(
        await h.req("/api/initiatives", {
          method: "POST",
          token: proposer,
          json: { ...draft, ...extra },
        }),
        field,
      );
      await rejected(
        await h.req(`/api/initiatives/${row.slug}/revisions`, {
          method: "POST",
          token: proposer,
          json: { ...revisionBody(draft), ...extra },
        }),
        field,
      );
    }
    await rejected(
      await h.req("/api/initiatives", {
        method: "POST",
        token: proposer,
        json: {
          ...draft,
          backers: [{ org: "Backer", amountUsd: 100, logoURL: "https://example.com/logo.png" }],
        },
      }),
      "backers[0].logoURL",
    );
    const files = syntheticContentFiles();
    await rejected(
      await h.req("/api/admin/sync-content", {
        method: "POST",
        token: admin,
        json: { files: [files[0], { ...files[1], typo: true }] },
      }),
      "files[1].typo",
    );
    await rejected(
      await h.req("/api/donate/confirm", {
        method: "POST",
        json: { slug: row.slug, txHash: TX, terms: { chainId: 1, [UNKNOWN]: true } },
      }),
      "terms",
    );
    assertEquals(await h.db.initiatives.get(row.id), row);
    assertEquals((await h.db.initiatives.list(["pending", "approved"])).length, 1);
    assertEquals((await h.db.revisions.list(row.id)).length, 1);
    assertEquals(h.fetchLog, []);
    assertEquals(h.script.calls, []);
  } finally {
    h.close();
  }
});

Deno.test("writes: malformed JSON cannot become an empty update or logout", async () => {
  const { h, admin, row, base } = await setup();
  try {
    for (const body of ['{"sortRank":"1",', "[]", "null", "true", '"text"']) {
      for (const [method, path] of [["PATCH", base], ["POST", "/api/auth/logout"]]) {
        const res = await h.req(path, {
          method,
          token: admin,
          headers: { "Content-Type": "application/json" },
          body,
        });
        assertEquals(res.status, 400);
        assertEquals((await j(res)).error, "Expected a JSON object.");
      }
    }
    for (const field of ["goalUsd", UNKNOWN, "", "__proto__", "constructor", "toString"]) {
      await rejected(
        await h.req(base, {
          method: "PATCH",
          token: admin,
          json: { sortRank: "1", [field]: true },
        }),
        field,
      );
    }
    assertEquals(await h.db.initiatives.get(row.id), row);
    assert(await h.db.sessions.get(admin, false));
    // Bodyless actions still accept no body or an empty object.
    for (const json of [undefined, {}]) {
      assertEquals(
        (await h.req("/api/admin/audit/test", { method: "POST", token: admin, json })).status,
        200,
      );
    }
  } finally {
    h.close();
  }
});

Deno.test("writes: unknown actions cannot match inherited object properties", async () => {
  const { h, admin, row, comment, base } = await setup();
  try {
    for (const action of ["nonexistent", "constructor", "toString", "__proto__"]) {
      for (
        const [path, json] of [
          [`${base}/status`, { action }],
          ["/api/admin/initiatives/bulk", { action, ids: [row.id] }],
          ["/api/admin/comments/bulk", { action, ids: [comment.id] }],
        ] as const
      ) {
        assertEquals((await h.req(path, { method: "POST", token: admin, json })).status, 400);
      }
    }
    assertEquals(await h.db.initiatives.get(row.id), row);
    assertEquals(await h.db.comments.get(comment.id), comment);
  } finally {
    h.close();
  }
});
