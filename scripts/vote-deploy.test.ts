import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { getAddress, keccak256, slice, toBytes } from "viem";
import { pledgeChainId } from "../shared/vote/typed-data.ts";
import {
  checkAsks,
  checkCodeSize,
  CODE_SIZE_LIMIT,
  currencyMismatch,
  MAINNET_CURRENCIES,
  manifestFor,
  parseMinters,
  parseRealArgs,
  parseRoundAdmins,
  parseTestIncludes,
  parseTestTiming,
  planDonationSetup,
  poolDrift,
  poolUsdFromFeed,
  qualifyingCards,
  realSchedule,
  regroupPlan,
  roleChecks,
  TEST_POOL_ETH,
  testCurrencies,
  tierMax,
  USD_CURRENCY,
  voteSchedule,
} from "./vote-deploy.ts";
import {
  addingOpen,
  addPlan,
  nextAddingOpen,
  planGroups,
  planInitiatives,
} from "../shared/vote/add-plan.ts";
import { CHAINLINK_FEEDS, TOKENS } from "../api/config.ts";

// The plan (vote fact sheet): opens Nov 17, S-Tier Thu Dec 3, A-Tier Mon Dec 7,
// B-Tier Wed Dec 9, every tally at 21:00 UTC.
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
  assertEquals(plan[0].goalUsd, 279_000_000_000n);
  assertEquals(plan[1].goalUsd, 12_500_000n);
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

Deno.test("voteSchedule: S-Tier 30 min after opening, the three tiers 30 min at most", () => {
  const s = voteSchedule(1793800000);
  const open = 1793800000 + 30 * 60;
  const S = open + 30 * 60;
  const tier = 320 + 160 + 80 + 40; // 5 min 20 s down to 40 s
  assertEquals(tier, 10 * 60);
  assertEquals(s, {
    opensAt: open,
    initialWindow: 320,
    firstTallyAt: [S, S + tier, S + 2 * tier],
    maxWindows: 4,
  });
  assertEquals(s.firstTallyAt[2] + tierMax(s) - S, 30 * 60);
});

Deno.test("voteSchedule: overnight rehearsal ends at the requested local noon", () => {
  const timing = parseTestTiming({
    until: "2026-11-17T12:00:00+05:30",
    "setup-minutes": "10",
  });
  const now = at("2026-11-16T15:00:00Z");
  const s = voteSchedule(now, timing);
  assertEquals(s.opensAt, now + 600);
  assertEquals(s.firstTallyAt, [
    at("2026-11-17T06:00:00Z"),
    at("2026-11-17T06:10:00Z"),
    at("2026-11-17T06:20:00Z"),
  ]);
  assertEquals(s.firstTallyAt[2] + tierMax(s), at("2026-11-17T06:30:00Z"));
  assertThrows(() => voteSchedule(timing.until! - 2400, timing), Error, "voting time");
  assertThrows(() => voteSchedule(timing.until!, timing), Error, "voting time");
});

Deno.test("parseTestTiming: rejects ambiguous dates, short setups and real votes", () => {
  assertEquals(parseTestTiming({}), {});
  for (const until of ["tomorrow", "2026-11-17", "2026-11-17T12:00:00", ""]) {
    assertThrows(() => parseTestTiming({ until }), Error, "explicit time zone");
  }
  for (const minutes of ["", "0", "-1", "4", "5.5", "NaN", "Infinity"]) {
    assertThrows(() => parseTestTiming({ "setup-minutes": minutes }), Error, "at least 5");
  }
  assertThrows(
    () => parseTestTiming({ real: true, until: "2026-11-17T06:30:00Z" }),
    Error,
    "test votes",
  );
  assertThrows(() => parseTestTiming({ real: true, "setup-minutes": "10" }), Error, "test votes");
});

Deno.test("voteSchedule: nine halving windows from 30 minutes finish at midnight", () => {
  const timing = parseTestTiming({
    until: "2026-11-17T00:00:00+05:30",
    "setup-minutes": "10",
    "window-minutes": "30",
    windows: "9",
  });
  const s = voteSchedule(at("2026-11-16T15:00:00Z"), timing);
  assertEquals(s.initialWindow, 1800);
  assertEquals(s.maxWindows, 9);
  assertEquals(tierMax(s), 3592);
  assertEquals(s.firstTallyAt, [
    at("2026-11-16T15:30:24Z"),
    at("2026-11-16T16:30:16Z"),
    at("2026-11-16T17:30:08Z"),
  ]);
  assertEquals(s.firstTallyAt[2] + tierMax(s), timing.until);
  assertThrows(() => voteSchedule(s.firstTallyAt[0] - 600, timing), Error, "voting time");
});

Deno.test("parseTestTiming: window options match the contract's bounds", () => {
  for (const minutes of ["", "0", "-1", "0.5", "Infinity", "NaN", "9007199254740991"]) {
    assertThrows(() => parseTestTiming({ "window-minutes": minutes }), Error, "positive whole");
  }
  for (const windows of ["", "0", "-1", "1.5", "65", "NaN"]) {
    assertThrows(() => parseTestTiming({ windows }), Error, "from 1 to 64");
  }
  assertThrows(() => parseTestTiming({ "window-minutes": "1", windows: "7" }), Error, "one second");
  assertThrows(() => parseTestTiming({ real: true, "window-minutes": "30" }), Error, "test votes");
  assertThrows(() => parseTestTiming({ real: true, windows: "9" }), Error, "test votes");
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
  // B-Tier's first tally comes 5 min 38 s after A-Tier's latest end: allowed.
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

Deno.test("manifestFor: the real vote names the badge on mainnet; a test vote runs on Sepolia", () => {
  const s = realSchedule(OPENS, PLAN);
  const base = {
    contract: SAFE2 as `0x${string}`,
    deployBlock: 5,
    schedule: s,
    poolUsd: 7n,
    slugs: ["x"],
    projects: [{ goalUsd: "5", rfp: false, groups: [] }],
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
    projects: [{ goalUsd: "5", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
    ballotRules: true,
  });
  const test = manifestFor({ ...base, kind: "test" });
  assertEquals([test.chainId, test.badge], [11155111, undefined]);
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

  // The plan: two days free between S-Tier's latest end and A-Tier, and 5 min 38 s before B.
  const s = realSchedule(OPENS, PLAN);
  assertEquals(addingOpen(s, PLAN[0] - 1), true);
  assertEquals(addingOpen(s, PLAN[0] + 24 * 3600), false); // S-Tier settling
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
    slugs: ["a", "b"],
    projects: [
      { goalUsd: "1", rfp: false, groups: [0] },
      { goalUsd: "1", rfp: false, groups: [] },
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
  assertEquals(manifest.projects[2], { goalUsd: "2000000", rfp: false, groups: [0, 1] });
  assertThrows(() => addPlan(base, [{ slug: "a", goalUsd: 1, safeAddress: "" }]), Error, "already");
});

Deno.test("regroupPlan: new groups, then only the projects whose groups changed", () => {
  const base = manifestFor({
    kind: "test",
    contract: SAFE as `0x${string}`,
    deployBlock: 5,
    schedule: voteSchedule(1_000),
    poolUsd: 7n,
    slugs: ["a", "b", "c", "gone", "r"],
    projects: [
      { goalUsd: "1", rfp: false, groups: [0] },
      { goalUsd: "1", rfp: false, groups: [] },
      { goalUsd: "1", rfp: false, groups: [0] },
      { goalUsd: "1", rfp: false, groups: [0] },
      { goalUsd: "1", rfp: true, groups: [] },
    ],
    groups: ["Seal"],
    independentTiers: 1,
  });
  const card = (slug: string, affiliations: string[], type?: "rfp") => ({
    slug,
    goalUsd: 1,
    safeAddress: "",
    affiliations,
    ...(type ? { type } : {}),
  });
  const { calls, manifest, changed } = regroupPlan(base, [
    card("a", ["seal"]), // unchanged (case ignored)
    card("b", ["Keys", "Seal"]), // joins two
    card("c", []), // leaves Seal, for the affiliation its title (here its slug) names
    card("r", [], "rfp"),
    card("new", ["Other"]), // not in the round: ignored
  ]);
  assertEquals(changed, ["b", "c"]);
  assertEquals(calls.map((c) => c.fn), [
    "addGroup",
    "addGroup",
    "setInitiativeGroups",
    "setInitiativeGroups",
  ]);
  assertEquals(calls[2].args, [1n, 0b11n]);
  assertEquals(calls[3].args, [2n, 0b100n]);
  assertEquals(manifest.groups, ["Seal", "Keys", "c"]);
  assertEquals(manifest.projects.map((p) => p.groups), [[0], [1, 0], [2], [0], []]);
  // Nothing to do: no calls.
  assertEquals(regroupPlan(manifest, [card("b", ["Keys", "Seal"])]).calls, []);
  assertThrows(() => regroupPlan(base, [card("r", ["Seal"])]), Error, "RFP");
});

Deno.test("regroupPlan: a grant the board lists unaffiliated keeps its own affiliation, else its title's (#147)", () => {
  const base = manifestFor({
    kind: "test",
    contract: SAFE as `0x${string}`,
    deployBlock: 5,
    schedule: voteSchedule(1_000),
    poolUsd: 7n,
    slugs: ["a", "b", "c"],
    projects: [
      { goalUsd: "1", rfp: false, groups: [1] }, // its own: Remix
      { goalUsd: "1", rfp: false, groups: [0] }, // the last of Seal
      { goalUsd: "1", rfp: false, groups: [2] }, // Keys, now someone else's on the board
    ],
    groups: ["Seal", "Remix", "Keys"],
    independentTiers: 1,
  });
  const card = (slug: string, affiliations: string[], title?: string) => ({
    slug,
    goalUsd: 1,
    safeAddress: "",
    affiliations,
    ...(title ? { title } : {}),
  });
  const { changed, manifest } = regroupPlan(base, [
    card("a", [], "Something else: x"), // its own Remix, though the title names another
    card("b", [], "Seal: x"), // the title names Seal: it stays
    card("c", [], "Acme: x"), // Keys is the board's: Acme, from its title
    card("d", ["Keys", "Seal"]),
  ]);
  assertEquals(changed, ["c"]);
  assertEquals(manifest.groups, ["Seal", "Remix", "Keys", "Acme"]);
  assertEquals(manifest.projects.map((p) => p.groups), [[1], [0], [3]]);
});

// ------------------------------------------------------- currencies and pledges
const ROLE = keccak256(toBytes("PLEDGE_ROLE"));
const ADMIN_A = "0x1000000000000000000000000000000000000001";
const ADMIN_B = "0x2000000000000000000000000000000000000002";
const pledgeCards = [
  {
    slug: "x",
    goalUsd: 1,
    safeAddress: SAFE,
    pledges: [
      { id: "p1", amountUsd: 5000, status: "pledged" as const },
      { id: "p2", amountUsd: 100, status: "received" as const },
      { id: "p3", amountUsd: 7, status: "withdrawn" as const },
    ],
  },
  {
    slug: "y",
    goalUsd: 2,
    safeAddress: SAFE2,
    pledges: [{ id: "p4", amountUsd: 12.5, status: "pledged" as const }],
  },
];
const TEST_USD = "0x3000000000000000000000000000000000000003";
const setup = (real: boolean) =>
  planDonationSetup({
    real,
    currencies: real ? MAINNET_CURRENCIES : testCurrencies(TEST_USD),
    admins: [ADMIN_A, ADMIN_B, ADMIN_A.toLowerCase()],
    pledgeRole: ROLE,
    cards: pledgeCards,
    plan: planInitiatives(pledgeCards, { real: true }),
  });

Deno.test("registers the configured currencies before opening", () => {
  const regs = setup(true).filter((c) => c.fn === "registerCurrency");
  assertEquals(
    regs.map((c) => c.args),
    MAINNET_CURRENCIES.map((c) => [c.asset, c.usdFeed]),
  );
  assertEquals(MAINNET_CURRENCIES.map((c) => c.symbol), [
    "ETH",
    "USDC",
    "EURC",
    "USDT",
    "DAI",
    "USDS",
    "crvUSD",
    "BOLD",
    "fxUSD",
    "ZCHF",
  ]);
  // Currencies come first: they freeze at opening.
  const n = MAINNET_CURRENCIES.length;
  assertEquals(
    setup(true).slice(0, n).map((c) => c.fn),
    Array(n).fill("registerCurrency"),
  );
});

Deno.test("mainnet currencies cover every website asset with explicit USD and CHF pricing", () => {
  const registered = new Map(MAINNET_CURRENCIES.map((c) => [c.symbol, c]));
  assertEquals(
    [...registered.keys()].sort(),
    ["ETH", ...Object.keys(TOKENS)].sort(),
  );
  assertEquals(registered.get("ETH")!.asset, ZERO_ADDR);
  assertEquals(registered.get("ETH")!.usdFeed, CHAINLINK_FEEDS.ETH);
  for (const [symbol, [asset]] of Object.entries(TOKENS)) {
    assertEquals(
      registered.get(symbol)!.asset.toLowerCase(),
      asset.toLowerCase(),
    );
    if (symbol !== "EURC" && symbol !== "ZCHF") {
      assertEquals(registered.get(symbol)!.usdFeed, ZERO_ADDR);
    }
  }
  assertEquals(registered.get("ZCHF")!.usdFeed, CHAINLINK_FEEDS.ZCHF);
  assertEquals(registered.get("EURC")!.usdFeed, CHAINLINK_FEEDS.EURC);
  assertEquals(MAINNET_CURRENCIES.length + 1 <= 32, true);
});

Deno.test("grants the pledge role to each admin", () => {
  const grants = setup(true).filter((c) => c.fn === "grantRole");
  assertEquals(grants.map((c) => c.args), [[ROLE, ADMIN_A], [ROLE, ADMIN_B]]);
});

Deno.test("seeds the board's open pledges and skips received and withdrawn ones", () => {
  const pledges = setup(true).filter((c) => c.fn === "setPledge");
  assertEquals(pledges.map((c) => c.args), [
    [pledgeChainId("p1"), 0n, 0n, 5_000_000_000n],
    [pledgeChainId("p4"), 1n, 0n, 12_500_000n],
  ]);
});

Deno.test("a test round registers its test dollar and the same pledges, no pledge signers", () => {
  const calls = setup(false);
  assertEquals(calls.map((c) => c.fn), ["registerCurrency", "setPledge", "setPledge"]);
  // Valued at $1: no feed.
  assertEquals(calls[0].args, [TEST_USD, "0x0000000000000000000000000000000000000000"]);
  assertEquals(
    calls.slice(1).map((c) => c.args),
    setup(true).filter((c) => c.fn === "setPledge").map((c) => c.args),
  );
  assertEquals(testCurrencies(TEST_USD)[0].symbol, "tUSD");
});

Deno.test("manifestFor records currencies and accounts when given", () => {
  const m = manifestFor({
    kind: "real",
    contract: SAFE2 as `0x${string}`,
    deployBlock: 5,
    schedule: realSchedule(OPENS, PLAN),
    poolUsd: 7n,
    slugs: ["x"],
    projects: [{ goalUsd: "5", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
    currencies: MAINNET_CURRENCIES,
    accounts: [SAFE as `0x${string}`],
  });
  assertEquals(m.currencies, MAINNET_CURRENCIES);
  assertEquals(m.accounts, [SAFE]);
});

Deno.test("addPlan appends the new project's account when the manifest records them", () => {
  const base = manifestFor({
    kind: "real",
    contract: SAFE2 as `0x${string}`,
    deployBlock: 5,
    schedule: realSchedule(OPENS, PLAN),
    poolUsd: 7n,
    slugs: ["a"],
    projects: [{ goalUsd: "1", rfp: false, groups: [] }],
    groups: [],
    independentTiers: 1,
    currencies: MAINNET_CURRENCIES,
    accounts: [SAFE as `0x${string}`],
  });
  const { manifest } = addPlan(base, [{ slug: "b", goalUsd: 1, safeAddress: SAFE2 }]);
  assertEquals(manifest.accounts, [SAFE, SAFE2]);
});

Deno.test("deploy: code over EIP-170's limit is refused before it is sent", async () => {
  const code = (bytes: number) => `0x${"00".repeat(bytes)}` as const;
  checkCodeSize("X", code(CODE_SIZE_LIMIT));
  assertThrows(() => checkCodeSize("X", code(CODE_SIZE_LIMIT + 1)), Error, "24577 bytes");
  // The built round fits (when it has been built).
  const built = await Deno.readTextFile(
    new URL("../vote/out/SignedBallots.sol/SignedBallots.json", import.meta.url),
  ).catch(() => null);
  if (built) {
    checkCodeSize("SignedBallots", JSON.parse(built).deployedBytecode.object);
  }
});

Deno.test("deploy: the relayer ends the setup with none of the handed-over roles, PLEDGE_ROLE included", () => {
  const [d, a, p, m] = ["0xd0", "0xa0", "0x90", "0x30"] as const;
  const admin = "0x0000000000000000000000000000000000000001" as const;
  const relayer = "0x0000000000000000000000000000000000000002" as const;
  const signer = "0x0000000000000000000000000000000000000003";
  const base = { handed: [d, a, p], minter: m, admin, relayer, admins: [signer] };
  const real = roleChecks({ ...base, real: true });
  for (const r of [d, a, p]) {
    assertEquals(real.filter(([x, who]) => x === r && who === relayer), [[r, relayer, false]]);
    assertEquals(real.filter(([x, who]) => x === r && who === admin), [[r, admin, true]]);
  }
  assertEquals(real.filter(([, who]) => who === signer), [[p, signer, true]]);
  assertEquals(real.some(([x]) => x === m), false);
  const test = roleChecks({ ...base, real: false });
  assertEquals(test.filter(([x]) => x === m), [[m, relayer, true]]);
  assertEquals(test.some(([, who]) => who === signer), false);
});

Deno.test("deploy: every requested round admin receives all three roles and the deployer loses them", () => {
  const handed = ["0xd0", "0xa0", "0x90"] as const;
  const deployer = "0x0000000000000000000000000000000000000002" as const;
  const requested = [
    "0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF",
    "0x839395e20bbB182fa440d08F850E6c7A8f6F0780",
    "0xE930779472c04Dd97AF5b8B83d9EC95ABdA38dcE",
  ];
  const admins = parseRoundAdmins(requested.join(","), deployer);
  assertEquals(admins, requested);
  const checks = roleChecks({
    real: true,
    handed: [...handed],
    minter: "0x30",
    admin: admins[0],
    roundAdmins: admins,
    relayer: deployer,
    admins: [],
  });
  for (const role of handed) {
    assertEquals(
      checks.filter(([r, , held]) => r === role && held).map(([, a]) => a),
      admins,
    );
    assertEquals(checks.filter(([r, a]) => r === role && a === deployer), [[
      role,
      deployer,
      false,
    ]]);
  }
});

Deno.test("parseRoundAdmins: rejects an empty handover, invalid addresses and the renouncing deployer", () => {
  const deployer = "0x0000000000000000000000000000000000000002" as const;
  const admin = "0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF";
  assertEquals(parseRoundAdmins(undefined, deployer), [admin]);
  assertEquals(parseRoundAdmins(`${admin}, ${admin.toLowerCase()}`, deployer), [
    admin,
  ]);
  assertThrows(() => parseRoundAdmins(" , ", deployer), Error, "at least one");
  assertThrows(
    () => parseRoundAdmins("nope", deployer),
    Error,
    "nonzero address",
  );
  assertThrows(
    () => parseRoundAdmins(ZERO_ADDR, deployer),
    Error,
    "nonzero address",
  );
  assertThrows(
    () => parseRoundAdmins(`${admin},${deployer}`, deployer),
    Error,
    "renounces",
  );
});

Deno.test("deploy: --minter gives a test round's MINTER_ROLE to the site's relayer too", () => {
  const deployer = "0x22797B059E20C1ef64CFe12815e09c0E984832F3" as const;
  const site = "0xC36A23065a7EC768B4f0e161EB94615FAA77404e";
  assertEquals(parseMinters(undefined, false, deployer), []);
  // Checksummed, once, and never the deployer (it mints already).
  assertEquals(
    parseMinters(`${site.toLowerCase()}, ${site},${deployer}`, false, deployer),
    [site],
  );
  assertThrows(() => parseMinters("nope", false, deployer), Error, "isn't an address");
  assertThrows(() => parseMinters(site, true, deployer), Error, "test votes");
  const m = "0x30" as const;
  const checks = roleChecks({
    real: false,
    handed: ["0xd0", "0xa0", "0x90"],
    minter: m,
    admin: "0x0000000000000000000000000000000000000001",
    relayer: deployer,
    admins: [],
    minters: [site as `0x${string}`],
  });
  assertEquals(checks.filter(([x]) => x === m), [[m, deployer, true], [m, site, true]]);
});

Deno.test("deploy: the currencies read back must be the manifest's, in order", () => {
  const want = [USD_CURRENCY, ...MAINNET_CURRENCIES];
  // Addresses compare in any case: the chain reads them checksummed.
  const got = want.map((c) => ({ asset: c.asset.toLowerCase(), usdFeed: c.usdFeed.toLowerCase() }));
  assertEquals(currencyMismatch(want, got), null);
  assertEquals(
    currencyMismatch(want, got.slice(1)),
    `${want.length - 1} currencies, expected ${want.length}`,
  );
  const swapped = [got[0], got[2], got[1], ...got.slice(3)];
  assertNotEquals(currencyMismatch(want, swapped), null);
  const feed = got.map((c, i) => (i === 1 ? { ...c, usdFeed: ZERO_ADDR } : c));
  assertEquals(currencyMismatch(want, feed)?.includes("has feed"), true);
});

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// Admin → Vote's qualify settings (#99): raised at least 25% of the goal, $200,000 at most left.
const QUALIFY = { show: true, floorPct: 25, capUsd: 200_000 };
const card = (slug: string, goalUsd: number, raisedUsd: number, pledged = raisedUsd) => ({
  slug,
  goalUsd,
  safeAddress: "",
  raisedUsd,
  pledges: [{ id: `${slug}-p`, amountUsd: pledged, status: "pledged" as const }],
});

Deno.test("qualifyingCards: a test round keeps only the initiatives that qualify, in board order", () => {
  const cards = [
    card("quarter", 100_000, 25_000), // exactly 25%
    card("short", 100_000, 24_999), // under 25%
    card("big-left", 1_000_000, 790_000), // 79%, but $210,000 left
    card("big-ok", 1_000_000, 800_000), // $200,000 left
    card("nothing", 0, 0),
  ];
  assertEquals(qualifyingCards(cards, QUALIFY).map((c) => c.slug), ["quarter", "big-ok"]);
});

Deno.test("qualifyingCards: settings with show off still apply (only the board mark is hidden)", () => {
  const cards = [card("in", 100_000, 30_000), card("out", 100_000, 10_000)];
  assertEquals(
    qualifyingCards(cards, { ...QUALIFY, show: false }).map((c) => c.slug),
    ["in"],
  );
});

Deno.test("parseTestIncludes: deduplicates rehearsal exceptions and refuses real votes", () => {
  assertEquals(parseTestIncludes(undefined), []);
  assertEquals(parseTestIncludes(" assertions, vaults, assertions, "), [
    "assertions",
    "vaults",
  ]);
  assertThrows(
    () => parseTestIncludes(" , "),
    Error,
    "at least one initiative slug",
  );
  assertThrows(
    () => parseTestIncludes("vaults", true),
    Error,
    "only for test votes",
  );
});

Deno.test("qualifyingCards: named rehearsal exceptions preserve board order and other exclusions", () => {
  const cards = [
    card("assertions", 75_000, 50),
    card("eligible", 100_000, 25_000),
    card("vaults", 240_000, 206.4),
    card("whitehat", 200_000, 0),
    card("excluded", 100_000, 0),
  ];
  const include = ["whitehat", "vaults", "assertions", "eligible"];
  const selected = qualifyingCards(cards, QUALIFY, include);
  assertEquals(selected.map((c) => c.slug), [
    "assertions",
    "eligible",
    "vaults",
    "whitehat",
  ]);
  checkAsks(selected, QUALIFY, include);
  assertEquals(qualifyingCards(cards, QUALIFY).map((c) => c.slug), [
    "eligible",
  ]);
  assertThrows(
    () => qualifyingCards(cards, QUALIFY, ["typo"]),
    Error,
    "not on the board",
  );
  for (const goal of [0, -1, NaN, Infinity]) {
    assertThrows(
      () => qualifyingCards([card("invalid", goal, 0)], QUALIFY, ["invalid"]),
      Error,
      "positive finite goal",
    );
  }
});

Deno.test("checkAsks: an explicit rehearsal exception leaves every other ask capped", () => {
  const vaults = card("vaults", 240_000, 0);
  const donated = card("donated", 400_000, 220_000, 150_000);
  checkAsks([vaults], QUALIFY, ["vaults"]);
  assertThrows(
    () => checkAsks([vaults], QUALIFY),
    Error,
    "vaults asks $240,000",
  );
  assertThrows(
    () => checkAsks([vaults, donated], QUALIFY, ["vaults"]),
    Error,
    "donated asks $250,000",
  );
});

Deno.test("checkAsks: refuses a round where an ask is over the cap once only open pledges count", () => {
  // Qualifies on the board through donations, but the round only copies the pledges:
  // its ask is the goal less the open pledges, $250,000.
  const donated = card("donated", 400_000, 220_000, 150_000);
  assertThrows(
    () => checkAsks([card("fine", 100_000, 30_000), donated], QUALIFY),
    Error,
    "donated asks $250,000",
  );
  checkAsks([card("fine", 100_000, 30_000), card("edge", 400_000, 200_000)], QUALIFY);
});

// #97: a test round's pool is 400 ETH at the live ETH/USD price (Chainlink, 8 decimals).
const NOW = at("2026-11-16T12:00:00Z");

Deno.test("poolUsdFromFeed: 400 ETH at $1,813 is $725,200, in six decimals", () => {
  assertEquals(poolUsdFromFeed(TEST_POOL_ETH, 181_300_000_000n, NOW - 600, NOW), 725_200_000_000n);
});

Deno.test("poolUsdFromFeed: refuses a stale, empty or absurd price", () => {
  assertThrows(() => poolUsdFromFeed(400, 181_300_000_000n, NOW - 3 * 3600, NOW), Error, "stale");
  assertThrows(() => poolUsdFromFeed(400, 0n, NOW, NOW), Error, "no ETH price");
  assertThrows(() => poolUsdFromFeed(400, 5_000_000n, NOW, NOW), Error, "out of range");
});

Deno.test("poolDrift: how far a hand-set pool is from the live estimate, as a share", () => {
  assertEquals(poolDrift(1_000_000_000_000n, 725_200_000_000n).toFixed(3), "0.379");
  assertEquals(poolDrift(725_200_000_000n, 725_200_000_000n), 0);
});

Deno.test("voteSchedule: a 27-hour vote reserves its final three hours for nine windows per tier", () => {
  const timing = parseTestTiming({ "duration-hours": "27", "window-minutes": "30", windows: "9" });
  const s = voteSchedule(1_800_000_000, timing);
  const span = tierMax(s);
  assertEquals(s.maxWindows, 9);
  assertEquals(span, 3592);
  assertEquals(s.firstTallyAt[2] + span - s.opensAt, 27 * 3600);
  assertEquals(s.firstTallyAt[0] - s.opensAt, 24 * 3600 + 24);
  assertEquals(s.firstTallyAt[1] - s.firstTallyAt[0], span);
  assertEquals(s.firstTallyAt[2] - s.firstTallyAt[1], span);
  assertThrows(
    () => parseTestTiming({ "duration-hours": "27", until: "2026-11-18T12:00:00Z" }),
    Error,
    "not both",
  );
  assertThrows(() => parseTestTiming({ real: true, "duration-hours": "27" }), Error, "test votes");
  for (const duration of ["0", "-1", "NaN", "Infinity", "0.00001"]) {
    assertThrows(() => parseTestTiming({ "duration-hours": duration }), Error, "positive");
  }
  assertThrows(
    () => voteSchedule(1_800_000_000, { ...timing, durationHours: 1 }),
    Error,
    "voting time",
  );
});
