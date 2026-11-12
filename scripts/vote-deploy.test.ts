import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { getAddress, keccak256, slice, toBytes } from "viem";
import {
  addingOpen,
  addPlan,
  manifestFor,
  nextAddingOpen,
  parseRealArgs,
  planGroups,
  planInitiatives,
  realSchedule,
  tierMax,
  voteSchedule,
} from "./vote-deploy.ts";

// The plan (vote fact sheet): opens Nov 17, Tier-S Thu Dec 3, Tier-A Mon Dec 7,
// Tier-B Wed Dec 9, every tally at 21:00 UTC.
const at = (iso: string) => Date.parse(iso) / 1000;
const OPENS = at("2026-11-17T17:00:00Z");
const PLAN: [number, number, number] = [
  at("2026-12-03T21:00:00Z"),
  at("2026-12-07T21:00:00Z"),
  at("2026-12-09T21:00:00Z"),
];
const PLAN_SPAN = 48 * 3600 - 338; // 24 h + 12 h + … + 5 min 37 s (9 windows), as the contract adds them

const SAFE = "0x2e72eE36F7575Fae93f94aAeDAA9E77db2259d59";

Deno.test("planInitiatives: board order, Safe as account, goal in six decimals", () => {
  const plan = planInitiatives([
    { slug: "b", goalUsd: 279000, safeAddress: SAFE },
    { slug: "a", goalUsd: 12.5, safeAddress: "" },
  ]);
  assertEquals(plan.map((p) => p.slug), ["b", "a"]);
  assertEquals(plan[0].account, SAFE);
  assertEquals(plan[0].askUsd, 279_000_000_000n);
  assertEquals(plan[1].askUsd, 12_500_000n);
  assertEquals(
    plan[1].account,
    getAddress(slice(keccak256(toBytes("test-round:a")), 12)),
  );
});

Deno.test("planInitiatives: a Safe used twice gets a placeholder the second time", () => {
  const plan = planInitiatives([
    { slug: "x", goalUsd: 1, safeAddress: SAFE },
    { slug: "y", goalUsd: 1, safeAddress: SAFE.toLowerCase() },
  ]);
  assertEquals(plan[0].account, SAFE);
  assertNotEquals(plan[1].account.toLowerCase(), SAFE.toLowerCase());
});

Deno.test("voteSchedule: S a day after opening, quiet windows 2 h down to 15 min", () => {
  const s = voteSchedule(1793800000);
  const open = 1793800000 + 30 * 60;
  const S = open + 24 * 3600;
  const tier = 7200 + 3600 + 1800 + 900;
  assertEquals(s, {
    opensAt: open,
    initialWindow: 7200,
    firstTallyAt: [S, S + tier, S + 2 * tier],
    maxWindows: 4,
  });
});

const SAFE2 = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";

Deno.test("planInitiatives, real vote: every initiative needs its own Safe", () => {
  const ok = planInitiatives([
    { slug: "x", goalUsd: 1, safeAddress: SAFE },
    { slug: "y", goalUsd: 2, safeAddress: SAFE2 },
  ], { real: true });
  assertEquals(ok.map((p) => p.account), [SAFE, SAFE2]);
  assertThrows(
    () => planInitiatives([{ slug: "x", goalUsd: 1, safeAddress: "" }], { real: true }),
    Error,
    "missing Safe: x",
  );
  assertThrows(
    () =>
      planInitiatives([
        { slug: "x", goalUsd: 1, safeAddress: SAFE },
        { slug: "y", goalUsd: 1, safeAddress: SAFE.toLowerCase() },
      ], { real: true }),
    Error,
    "Safe used twice: y",
  );
});

Deno.test("parseRealArgs: every flag is required, and S's tally comes after the opening", () => {
  const full = {
    opens: "2026-11-17T17:00:00Z",
    "s-tally": "2026-12-03T21:00:00Z",
    "a-tally": "2026-12-07T21:00:00Z",
    "b-tally": "2026-12-09T21:00:00Z",
    "pool-usd": "1250000",
    slugs: "round.txt",
  };
  assertEquals(parseRealArgs(full), {
    opensAt: OPENS,
    tallies: PLAN,
    poolUsd: 1_250_000_000_000n,
    slugsFile: "round.txt",
  });
  for (
    const flag of ["opens", "s-tally", "a-tally", "b-tally", "pool-usd", "slugs"] as const
  ) {
    assertThrows(() => parseRealArgs({ ...full, [flag]: undefined }), Error, `--${flag}`);
  }
  assertThrows(
    () => parseRealArgs({ ...full, "s-tally": full.opens }),
    Error,
    "--s-tally must come after --opens",
  );
});

Deno.test("realSchedule: the plan's dates, 9 windows from 24 h", () => {
  const s = realSchedule(OPENS, PLAN);
  assertEquals(s, { opensAt: OPENS, initialWindow: 86400, firstTallyAt: PLAN, maxWindows: 9 });
  // The last window: 5 min 37 s.
  assertEquals(86400 >> 8, 337);
  assertEquals(tierMax(s), PLAN_SPAN);
  // Tier-B's first tally comes 5 min 38 s after Tier-A's latest end: allowed.
  assertEquals(PLAN[2] - (PLAN[1] + tierMax(s)), 338);
});

Deno.test("realSchedule: a tier can't start while the one above may still be running", () => {
  assertThrows(
    () => realSchedule(OPENS, [PLAN[0], PLAN[0] + PLAN_SPAN - 1, PLAN[2]]),
    Error,
    "--a-tally must be at least",
  );
  assertThrows(
    () => realSchedule(OPENS, [PLAN[0], PLAN[1], PLAN[1] + 24 * 3600]),
    Error,
    "--b-tally must be at least",
  );
  assertThrows(() => realSchedule(PLAN[0] + 1, PLAN), Error, "--s-tally must come after");
});

Deno.test("manifestFor: the real vote names the badge on mainnet, a test vote its issuer", () => {
  const s = realSchedule(OPENS, PLAN);
  const base = {
    contract: SAFE2 as `0x${string}`,
    deployBlock: 5,
    schedule: s,
    poolUsd: 7n,
    slugs: ["x"],
    projects: [{ askUsd: "5", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
  };
  assertEquals(manifestFor({ ...base, kind: "real" }), {
    kind: "real",
    chainId: 1,
    contract: SAFE2,
    deployBlock: 5,
    opensAt: OPENS,
    // The latest the round can end: B's last window (the quiet ending runs the rest),
    // Fri Dec 11, 20:59:55 UTC.
    closesAt: PLAN[2] + PLAN_SPAN,
    schedule: s,
    poolUsd: "7",
    badge: "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C",
    slugs: ["x"],
    projects: [{ askUsd: "5", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
    ballotRules: true,
  });
  assertEquals(manifestFor({ ...base, kind: "test", issuer: SAFE as `0x${string}` }).issuer, SAFE);
  assertEquals(
    manifestFor({ ...base, kind: "test", issuer: SAFE as `0x${string}` }).chainId,
    11155111,
  );
});

// ------------------------------------------------------------ ballot rules
Deno.test("planGroups: one group per affiliation, ignoring case, in board order", () => {
  const g = planGroups([
    { slug: "a", goalUsd: 1, safeAddress: "", affiliations: ["Seal"] },
    { slug: "b", goalUsd: 1, safeAddress: "", affiliations: ["wallets", "seal"] },
    { slug: "c", goalUsd: 1, safeAddress: "" },
  ]);
  assertEquals(g.names, ["Seal", "wallets"]);
  assertEquals(["a", "b", "c"].map(g.groupsOf), [[0], [1, 0], []]);
  // Adding to a round keeps its groups' indexes.
  const more = planGroups([{
    slug: "d",
    goalUsd: 1,
    safeAddress: "",
    affiliations: ["SEAL", "Keys"],
  }], [
    "Seal",
    "wallets",
  ]);
  assertEquals(more.names, ["Seal", "wallets", "Keys"]);
  assertEquals(more.groupsOf("d"), [0, 2]);
});

Deno.test("planInitiatives carries rfp and groups; an RFP with affiliations throws", () => {
  const plan = planInitiatives([
    { slug: "a", goalUsd: 1, safeAddress: "", type: "grant", affiliations: ["Seal"] },
    { slug: "r", goalUsd: 1, safeAddress: "", type: "rfp" },
  ]);
  assertEquals(plan.map((p) => [p.rfp, p.groups]), [[false, [0]], [true, []]]);
  assertThrows(
    () =>
      planInitiatives([{
        slug: "r",
        goalUsd: 1,
        safeAddress: "",
        type: "rfp",
        affiliations: ["X"],
      }]),
    Error,
    "r: an RFP can't have affiliations",
  );
});

Deno.test("addingOpen: before opening, between tiers, never inside a span or after the end", () => {
  // A test vote: A starts as S's latest end passes, B likewise, so no gap until the end.
  const t = voteSchedule(1_000);
  const tSpan = tierMax(t);
  const tS = t.firstTallyAt[0];
  assertEquals(addingOpen(t, 500), true); // before opening
  assertEquals(addingOpen(t, tS - 1), true); // open, before S
  assertEquals(addingOpen(t, tS), false); // S's first tally
  assertEquals(addingOpen(t, tS + tSpan), false);
  assertEquals(nextAddingOpen(t, tS), null);
  assertEquals(addingOpen(t, t.firstTallyAt[2] + tSpan), false); // the end

  // The plan: two days free between Tier-S's latest end and Tier-A, and 5 min 38 s before B.
  const s = realSchedule(OPENS, PLAN);
  assertEquals(addingOpen(s, PLAN[0] - 1), true);
  assertEquals(addingOpen(s, PLAN[0] + 24 * 3600), false); // Tier-S settling
  assertEquals(nextAddingOpen(s, PLAN[0]), PLAN[0] + PLAN_SPAN); // Sat Dec 5, ~21:00 UTC
  assertEquals(addingOpen(s, PLAN[1] - 1), true);
  assertEquals(addingOpen(s, PLAN[2] + PLAN_SPAN), false); // the end
});

Deno.test("addPlan: new groups and projects for the admin, appended without reordering", () => {
  const base = manifestFor({
    kind: "test",
    contract: SAFE as `0x${string}`,
    deployBlock: 5,
    schedule: realSchedule(OPENS, PLAN),
    poolUsd: 7n,
    issuer: SAFE as `0x${string}`,
    slugs: ["a", "b"],
    projects: [
      { askUsd: "1", rfp: false, groups: [0] },
      { askUsd: "1", rfp: false, groups: [] },
    ],
    groups: ["Seal"],
    independentTiers: 1,
  });
  const { calls, manifest } = addPlan(base, [
    { slug: "c", goalUsd: 2, safeAddress: "", type: "grant", affiliations: ["seal", "Keys"] },
  ]);
  assertEquals(calls.map((c) => c.fn), ["addGroup", "addInitiative"]);
  assertEquals(calls[1].args.slice(1), [2_000_000n, false, 0b11n]);
  assertEquals(manifest.slugs, ["a", "b", "c"]);
  assertEquals(manifest.groups, ["Seal", "Keys"]);
  assertEquals(manifest.projects[2], { askUsd: "2000000", rfp: false, groups: [0, 1] });
  assertThrows(() => addPlan(base, [{ slug: "a", goalUsd: 1, safeAddress: "" }]), Error, "already");
});
