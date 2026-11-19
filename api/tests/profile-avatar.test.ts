import { assertEquals } from "@std/assert";
import {
  PRIVATE_BADGE_AVATAR,
  PRIVATE_BADGE_AVATAR_RULE,
  PRIVATE_BADGE_NAME_RULE,
  PRIVATE_BADGE_PFP,
} from "../../shared/profile.ts";
import { createBadgeChecker } from "../chain/badge.ts";
import { harness, j, PLAIN } from "./app-helpers.ts";
import { PNG } from "./image-fixtures.ts";

function picture() {
  const form = new FormData();
  form.append("image", new Blob([PNG], { type: "image/png" }), "me.png");
  return form;
}

Deno.test("private voting badge avatars override old pictures, and neither the avatar nor the name can be changed", async () => {
  const h = await harness({ env: { PINATA_JWT: "test" } });
  try {
    h.script.votingBadgeHolders.add(PLAIN.toLowerCase());
    await h.db.profiles.setNickname(PLAIN, "Voter");
    await h.db.profiles.setPfp(PLAIN, "ipfs:old-picture");
    const token = await h.mint(PLAIN);
    const expected = {
      nickname: "Voter",
      pfp: PRIVATE_BADGE_PFP,
      pfpUrl: PRIVATE_BADGE_AVATAR,
    };
    const profile = await h.req("/api/nickname/" + PLAIN);
    assertEquals(profile.status, 200);
    assertEquals(await j(profile), expected);
    const me = await j(await h.req("/api/auth/me", { token }));
    assertEquals({ nickname: me.nickname, pfp: me.pfp, pfpUrl: me.pfpUrl }, expected);

    for (
      const [path, init] of [
        ["/api/pfp", { json: { pfp: "preset:7" } }],
        ["/api/pfp/upload", { body: picture() }],
      ] as const
    ) {
      const res = await h.req(path, { method: "POST", token, ...init });
      assertEquals(res.status, 403);
      assertEquals((await j(res)).error, PRIVATE_BADGE_AVATAR_RULE);
    }
    assertEquals((await h.db.profiles.get(PLAIN)).pfp, "ipfs:old-picture");
    assertEquals(
      h.fetchLog.some(({ url }) => url.startsWith("https://uploads.pinata.cloud/")),
      false,
    );
    const rename = await h.req("/api/nickname", {
      method: "POST",
      token,
      json: { nickname: "New name" },
    });
    // Nor the name they were given (#140).
    assertEquals(rename.status, 403);
    assertEquals((await j(rename)).error, PRIVATE_BADGE_NAME_RULE);
    assertEquals((await j(await h.req("/api/nickname/" + PLAIN))).nickname, "Voter");
  } finally {
    h.close();
  }
});

Deno.test("public ETHSecurity badgeholders can still choose and upload avatars", async () => {
  const h = await harness({
    env: { PINATA_JWT: "test" },
    fetch: (url) =>
      url.startsWith("https://uploads.pinata.cloud/")
        ? Response.json({
          data: { cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" },
        })
        : new Response("not found", { status: 404 }),
  });
  try {
    h.script.badgeHolders.add(PLAIN.toLowerCase());
    const token = await h.mint(PLAIN);
    assertEquals(
      (await h.req("/api/pfp", {
        method: "POST",
        token,
        json: { pfp: "preset:7" },
      })).status,
      200,
    );
    assertEquals((await j(await h.req("/api/nickname/" + PLAIN))).pfp, "preset:7");
    const upload = await h.req("/api/pfp/upload", {
      method: "POST",
      token,
      body: picture(),
    });
    assertEquals(upload.status, 200);
    const profile = await j(await h.req("/api/nickname/" + PLAIN));
    assertEquals(profile.pfp, (await j(upload)).pfp);
  } finally {
    h.close();
  }
});

Deno.test("avatar writes recheck ownership even when a nonholder result is cached", async () => {
  const h = await harness();
  try {
    await h.db.profiles.setPfp(PLAIN, "preset:2");
    assertEquals((await j(await h.req("/api/nickname/" + PLAIN))).pfp, "preset:2");
    h.script.votingBadgeHolders.add(PLAIN.toLowerCase());
    const token = await h.mint(PLAIN);
    const res = await h.req("/api/pfp", { method: "POST", token, json: { pfp: "preset:7" } });
    assertEquals(res.status, 403);
    assertEquals((await h.db.profiles.get(PLAIN)).pfp, "preset:2");
    assertEquals((await j(await h.req("/api/nickname/" + PLAIN))).pfp, PRIVATE_BADGE_PFP);
  } finally {
    h.close();
  }
});

Deno.test("an unavailable or malformed badge response never unlocks avatar changes", async () => {
  const h = await harness({ env: { PINATA_JWT: "test" } });
  try {
    const token = await h.mint(PLAIN);
    await h.db.profiles.setPfp(PLAIN, "preset:2");
    for (const result of [new Error("RPC unavailable"), "0x", null]) {
      h.deps.chain.hasVotingBadge = createBadgeChecker(() => {
        if (result instanceof Error) return Promise.reject(result);
        return Promise.resolve(result);
      }, () => h.clock.now);
      assertEquals((await h.req("/api/nickname/" + PLAIN)).status, 503);
      assertEquals(
        (await h.req("/api/pfp", {
          method: "POST",
          token,
          json: { pfp: "preset:7" },
        })).status,
        503,
      );
      assertEquals(
        (await h.req("/api/pfp/upload", {
          method: "POST",
          token,
          body: picture(),
        })).status,
        503,
      );
    }
    assertEquals((await h.db.profiles.get(PLAIN)).pfp, "preset:2");
    assertEquals(h.fetchLog.length, 0);
  } finally {
    h.close();
  }
});
