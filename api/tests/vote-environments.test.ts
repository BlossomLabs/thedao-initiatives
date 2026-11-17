import { assertEquals, assertRejects } from "@std/assert";
import { ADMIN, harness, j } from "./app-helpers.ts";
import { NO_ROUND, type VoteManifest } from "../../shared/vote/manifest.ts";
import { roundKey } from "../../shared/vote/keys.ts";
import {
  createActiveVote,
  migrateVoteSettings,
  VOTE_ROUND_KEY,
  voteSettingKey,
} from "../services/vote-active.ts";
import type { VoteRound } from "../services/vote-chain.ts";

const test: VoteManifest = { ...NO_ROUND, contract: `0x${"12".repeat(20)}` };
const production: VoteManifest = {
  ...test,
  kind: "real",
  chainId: 1,
  badge: `0x${"34".repeat(20)}`,
};
const setting = (manifest: VoteManifest) => ({ round: { manifest, by: ADMIN, at: 1 } });

Deno.test("production and test routes resolve simultaneously without fallback", async () => {
  const h = await harness();
  try {
    h.deps.voteRound = () => Promise.resolve({ manifest: production } as VoteRound);
    h.deps.testVoteRound = () => Promise.resolve({ manifest: test } as VoteRound);
    const [a, b] = await Promise.all([
      h.req("/api/vote/manifest"),
      h.req("/api/vote-test/manifest"),
    ]);
    assertEquals((await j(a)).manifest, production);
    assertEquals((await j(b)).manifest, test);
    h.deps.testVoteRound = () => Promise.resolve(undefined);
    assertEquals((await j(await h.req("/api/vote-test/manifest"))).manifest, null);
    assertEquals((await j(await h.req("/api/vote/manifest"))).manifest, production);
    // A misconfigured resolver cannot expose a test round through production.
    h.deps.voteRound = () => Promise.resolve({ manifest: test } as VoteRound);
    assertEquals((await j(await h.req("/api/vote/manifest"))).manifest, null);
    assertEquals((await h.req("/api/vote/ballot", { method: "POST", json: {} })).status, 503);
  } finally {
    h.close();
  }
});

Deno.test("test administration has independent configuration and requires admin authentication", async () => {
  const h = await harness();
  try {
    await h.db.meta.set(voteSettingKey("production"), setting(production));
    await h.db.meta.set(voteSettingKey("test"), setting(test));
    const token = await h.mint(ADMIN, true);
    assertEquals((await h.req("/api/admin/vote-test-round")).status, 401);
    for (const [path, eth] of [["vote-round", 100], ["vote-test-round", 3]] as const) {
      assertEquals(
        (await h.req(`/api/admin/${path}/pool`, {
          method: "POST",
          token,
          json: { eth, sold: false },
        })).status,
        200,
      );
    }
    assertEquals(
      ((await j(await h.req("/api/admin/vote-round", { token }))).pool as { eth: number }).eth,
      100,
    );
    assertEquals(
      ((await j(await h.req("/api/admin/vote-test-round", { token }))).pool as { eth: number }).eth,
      3,
    );
    assertEquals(
      (await h.req("/api/admin/vote-test-round/round", { method: "DELETE", token, json: {} }))
        .status,
      200,
    );
    assertEquals(
      ((await j(await h.req("/api/admin/vote-round", { token }))).round as { contract: string })
        .contract,
      production.contract,
    );
    assertEquals(
      (await h.req("/api/admin/vote-test-round/round", {
        method: "POST",
        token,
        json: { chain: "ethereum", contract: production.contract },
      })).status,
      400,
    );
  } finally {
    h.close();
  }
});

Deno.test("legacy vote migration preserves records, is repeatable and never overwrites a configured environment", async () => {
  const h = await harness();
  try {
    await h.db.meta.set(VOTE_ROUND_KEY, setting(test));
    await h.db.meta.set(voteSettingKey("production"), setting(production));
    const old = ["vote", test.chainId, test.contract.toLowerCase(), "admin-badge-next"];
    await h.kv.set(old, 17);
    await migrateVoteSettings(h.db);
    assertEquals(await h.db.meta.get(voteSettingKey("test")), setting(test));
    assertEquals(await h.db.meta.get(voteSettingKey("production")), setting(production));
    const target = [...roundKey(test), "admin-badge-next"];
    assertEquals((await h.kv.get(target)).value, 17);
    await h.kv.set(target, 21);
    await h.db.meta.set(voteSettingKey("test"), {});
    await migrateVoteSettings(h.db);
    assertEquals((await h.kv.get(target)).value, 21);
    assertEquals(await h.db.meta.get(voteSettingKey("test")), {});
    assertEquals((await h.kv.get(old)).value, 17);
  } finally {
    h.close();
  }
});

Deno.test("environment-bound resolvers reject a manifest of the other kind", async () => {
  const active = createActiveVote({
    environment: "production",
    read: () => Promise.resolve(setting(test)),
    build: (manifest) => ({ manifest } as VoteRound),
  });
  await assertRejects(active, Error, "environment mismatch");
});
