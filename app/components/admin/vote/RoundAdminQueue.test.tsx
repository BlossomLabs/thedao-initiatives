import type { ReactElement } from "react";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { signTypedData, writeContract } from "wagmi/actions";
import type { RoundAdminQueueJson, ToSignJson } from "~/lib/api-types";
import { primeRound } from "~/lib/vote-round";
import { clock } from "~/lib/format";
import { NO_ROUND } from "../../../../shared/vote/manifest";
import RoundAdminQueue, { changeText } from "./RoundAdminQueue";
import { api as apiFn, ApiError } from "~/lib/api";
import { resetRoundAdminRuns } from "./round-admin-actions";

const ADMIN = "0x1111111111111111111111111111111111111111";
const SIG = ("0x" + "ab".repeat(65)) as `0x${string}`;
const api = apiFn;
const QUEUE = "/api/admin/vote-round/queue";

vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: ADMIN, isConnected: true, config: {}, connectors: [] }),
}));
const roundAdmin = vi.hoisted(() => ({ value: true }));
vi.mock("~/hooks/use-round-admin", () => ({
  useRoundAdmin: () => ({ isRoundAdmin: roundAdmin.value, loading: false }),
}));
vi.mock("~/hooks/use-vote-chain", () => ({ useEnsureVoteChain: () => () => Promise.resolve() }));
vi.mock("wagmi/actions", () => ({ signTypedData: vi.fn(), writeContract: vi.fn() }));
const waitReceipt = vi.hoisted(() => vi.fn());
vi.mock("~/hooks/use-vote-send", () => ({
  voteClient: () => ({
    waitForTransactionReceipt: waitReceipt,
    // An addGroup's receipt: the round's first affiliation (id 0), as planned.
    getTransactionReceipt: () =>
      import("viem").then(({ encodeAbiParameters, encodeEventTopics }) =>
        import("../../../../shared/vote/abi").then(({ SIGNED_BALLOTS_ABI }) => ({
          logs: [{
            address: "0x2000000000000000000000000000000000000002",
            topics: encodeEventTopics({
              abi: SIGNED_BALLOTS_ABI,
              eventName: "GroupAdded",
              args: { id: 0 },
            } as never),
            data: encodeAbiParameters([{ type: "bytes32" }], ["0x" + "00".repeat(32) as never]),
          }],
        }))
      ),
  }),
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

const item = (pid: string, over: Partial<ToSignJson> = {}): ToSignJson => ({
  rfpId: "rfp1",
  slug: "audits",
  title: "Audits",
  pid,
  company: `Company ${pid.slice(-1)}`,
  kind: "record",
  amountUsd: 1_000,
  fromUsd: null,
  status: "pledged",
  by: null,
  at: null,
  lastError: null,
  lastErrorAt: null,
  inFlight: null,
  ...over,
});
const PID_A = "01JPLEDGE0000000000000000A";
const PID_B = "01JPLEDGE0000000000000000B";
const PID_C = "01JPLEDGE0000000000000000C";

const prepared = (pid: string) => ({
  pid,
  typedData: {
    domain: {
      name: "BlossomBallots",
      version: "2",
      chainId: 1,
      verifyingContract: "0x1000000000000000000000000000000000000001",
    },
    types: { Pledge: [{ name: "pledgeId", type: "bytes32" }] },
    primaryType: "Pledge",
    message: {
      pledgeId: "0x" + "cd".repeat(32),
      initiativeId: "0",
      currencyId: "0",
      amount: "1000000000",
      nonce: "3",
      deadline: "1800000600",
    },
  },
});

const render = (ui: ReactElement) =>
  rtlRender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

let queue: RoundAdminQueueJson;
const calls: string[] = [];

beforeEach(() => {
  resetRoundAdminRuns();
  roundAdmin.value = true;
  waitReceipt.mockReset().mockResolvedValue({ status: "success" });
  calls.length = 0;
  vi.mocked(signTypedData).mockReset().mockResolvedValue(SIG);
  vi.mocked(apiFn).mockReset().mockImplementation((path: string) => {
    calls.push(path);
    if (path === QUEUE) return Promise.resolve(queue);
    if (path.endsWith("/prepare")) {
      return Promise.resolve(prepared(path.split("/").at(-2)!));
    }
    // The signed send: saved, no transaction needed.
    return Promise.resolve({ ok: true });
  });
});

it("RoundAdminQueue: Sign all signs the unsigned ones in order", async () => {
  queue = {
    kind: "real",
    ready: [],
    toSign: [
      item(PID_A),
      item(PID_B, { inFlight: { hash: ("0x" + "ee".repeat(32)) as `0x${string}` } }),
      item(PID_C, { kind: "edit", fromUsd: 500, by: ADMIN, at: 1_800_000_000 }),
    ],
  };
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign all" }));
  await waitFor(() =>
    expect(calls.filter((c) => c !== QUEUE)).toEqual([
      `${QUEUE}/rfp1/${PID_A}/prepare`,
      `${QUEUE}/rfp1/${PID_A}`,
      `${QUEUE}/rfp1/${PID_C}/prepare`,
      `${QUEUE}/rfp1/${PID_C}`,
    ])
  );
  expect(signTypedData).toHaveBeenCalledTimes(2);
});

it("RoundAdminQueue: while one pledge is being signed, no other Sign or Sign all starts", async () => {
  queue = { kind: "real", ready: [], toSign: [item(PID_A), item(PID_C)] };
  let signed!: (v: `0x${string}`) => void;
  vi.mocked(signTypedData).mockImplementation(() => new Promise((r) => (signed = r)));
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  const signA = await screen.findByRole("button", { name: "Sign Company A's pledge" });
  fireEvent.click(signA);
  await waitFor(() => expect(signA).toBeDisabled());
  const signC = screen.getByRole("button", { name: "Sign Company C's pledge" });
  expect(signC).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sign all" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sign all" }));
  fireEvent.click(signC);
  signed(SIG);
  await waitFor(() => expect(signC).not.toBeDisabled());
  expect(calls.filter((c) => c.endsWith("/prepare"))).toEqual([
    `${QUEUE}/rfp1/${PID_A}/prepare`,
  ]);
});

it("RoundAdminQueue: a blocked ready initiative shows its reason and a disabled button", async () => {
  queue = {
    kind: "real",
    ready: [{
      id: "rfp2",
      slug: "tooling",
      title: "Tooling",
      goalUsd: 20_000,
      raisedUsd: 12_000,
      safeAddress: "",
      type: "grant",
      affiliations: [],
      pledges: [],
      blocker: { kind: "no-safe" },
      claim: null,
    }],
    toSign: [],
  };
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  expect(await screen.findByText("Add a Safe first.")).toBeInTheDocument();
  expect(screen.getByText("Waiting for a round admin")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Put on the ballot" })).toBeDisabled();
});

it("RoundAdminQueue: a site admin without the round roles sees the list without buttons", async () => {
  roundAdmin.value = false;
  queue = {
    kind: "real",
    ready: [{
      id: "rfp2",
      slug: "tooling",
      title: "Tooling",
      goalUsd: 20_000,
      raisedUsd: 12_000,
      safeAddress: "0x1000000000000000000000000000000000000001",
      type: "grant",
      affiliations: [],
      pledges: [],
      blocker: null,
      claim: null,
    }],
    toSign: [item(PID_A)],
  };
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  expect(await screen.findByText("Qualified. A round admin puts it on the ballot."))
    .toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Put on the ballot" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign all" })).toBeNull();
});

it("RoundAdminQueue: Put on the ballot adds it with the wallet, waits for the round, then signs its pledge", async () => {
  const CONTRACT = "0x2000000000000000000000000000000000000002";
  const HASH = ("0x" + "12".repeat(32)) as `0x${string}`;
  const TEST_QUEUE = "/api/admin/vote-test-round/queue";
  const round = { ...NO_ROUND, contract: CONTRACT } as typeof NO_ROUND;
  primeRound(round, "test");
  vi.mocked(writeContract).mockReset().mockResolvedValue(HASH);
  const r = {
    id: "rfp2",
    slug: "tooling",
    title: "Tooling",
    goalUsd: 20_000,
    raisedUsd: 12_000,
    safeAddress: "0x1000000000000000000000000000000000000001",
    type: "grant" as const,
    affiliations: [],
    pledges: [{ pid: PID_A, company: "Acme", amountUsd: 5_000 }],
    blocker: null,
    claim: null,
  };
  vi.mocked(apiFn).mockImplementation((path: string) => {
    calls.push(path);
    if (path === TEST_QUEUE) return Promise.resolve({ kind: "test", ready: [r], toSign: [] });
    if (path.startsWith("/api/vote-test/manifest")) {
      // Read first to plan the add (not in yet), then until it shows.
      const first = !calls.slice(0, -1).some((c) => c.startsWith("/api/vote-test/manifest"));
      return Promise.resolve({
        manifest: first ? round : {
          ...round,
          slugs: [...round.slugs, "tooling"],
          projects: [...round.projects, { goalUsd: "20000000000", rfp: false, groups: [] }],
        },
      });
    }
    if (path.endsWith("/prepare")) return Promise.resolve(prepared(PID_A));
    return Promise.resolve({ ok: true });
  });
  render(<RoundAdminQueue env="test" title="Ready for the test ballot" />);
  fireEvent.click(await screen.findByRole("button", { name: "Put on the ballot" }));
  expect(await screen.findByText("On the ballot.")).toBeInTheDocument();
  // A grant without affiliations gets one of its own first (#147).
  expect(vi.mocked(writeContract).mock.calls.map(([, c]) => c.functionName)).toEqual([
    "addGroup",
    "addInitiative",
  ]);
  expect(writeContract).toHaveBeenLastCalledWith(
    {},
    expect.objectContaining({ address: CONTRACT, functionName: "addInitiative" }),
  );
  expect(calls).toContain(`${TEST_QUEUE}/rfp2/${PID_A}/prepare`);
  expect(calls).toContain(`${TEST_QUEUE}/rfp2/${PID_A}`);
  expect(screen.getByText("Recorded Acme $5,000")).toBeInTheDocument();
});

it("RoundAdminQueue: a Sign while Sign all runs is disabled", async () => {
  queue = { kind: "real", ready: [], toSign: [item(PID_A), item(PID_C)] };
  let signed!: (v: `0x${string}`) => void;
  vi.mocked(signTypedData).mockImplementation(() => new Promise((r) => (signed = r)));
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign all" }));
  const signC = screen.getByRole("button", { name: "Sign Company C's pledge" });
  await waitFor(() => expect(signC).toBeDisabled());
  expect(screen.getByRole("button", { name: "Sign all" })).toBeDisabled();
  // Clicking it anyway starts nothing: one signature at a time (one nonce).
  fireEvent.click(signC);
  signed(SIG);
  await waitFor(() =>
    expect(calls.filter((c) => c.endsWith("/prepare"))).toEqual([
      `${QUEUE}/rfp1/${PID_A}/prepare`,
      `${QUEUE}/rfp1/${PID_C}/prepare`,
    ])
  );
  await waitFor(() => expect(signTypedData).toHaveBeenCalledTimes(2));
  signed(SIG);
  await waitFor(() => expect(signC).not.toBeDisabled());
  // The queue is read again once, at the end, not after every signature.
  expect(calls.filter((c) => c === QUEUE)).toHaveLength(2);
});

it("RoundAdminQueue: the run's pledges can't be signed from the list while it runs", async () => {
  const CONTRACT = "0x2000000000000000000000000000000000000002";
  const TEST_QUEUE = "/api/admin/vote-test-round/queue";
  const round = { ...NO_ROUND, contract: CONTRACT } as typeof NO_ROUND;
  primeRound(round, "test");
  vi.mocked(writeContract).mockReset().mockResolvedValue(("0x" + "12".repeat(32)) as `0x${string}`);
  let signed!: (v: `0x${string}`) => void;
  vi.mocked(signTypedData).mockImplementation(() => new Promise((r) => (signed = r)));
  const r = {
    id: "rfp2",
    slug: "tooling",
    title: "Tooling",
    goalUsd: 20_000,
    raisedUsd: 12_000,
    safeAddress: "0x1000000000000000000000000000000000000001",
    type: "grant" as const,
    affiliations: [],
    pledges: [
      { pid: PID_A, company: "Company A", amountUsd: 5_000 },
      { pid: PID_C, company: "Company C", amountUsd: 5_000 },
    ],
    blocker: null,
    claim: null,
  };
  const inRound = {
    ...round,
    slugs: [...round.slugs, "tooling"],
    projects: [...round.projects, { goalUsd: "20000000000", rfp: false, groups: [] }],
  };
  let added = false;
  vi.mocked(apiFn).mockImplementation((path: string) => {
    calls.push(path);
    if (path === TEST_QUEUE) {
      // Once added, the queue lists its pledges as Pledges to sign.
      return Promise.resolve({
        kind: "test",
        ready: [r],
        toSign: [item(PID_A, { rfpId: "rfp2" }), item(PID_C, { rfpId: "rfp2" })],
      });
    }
    if (path.startsWith("/api/vote-test/manifest")) {
      const m = added ? inRound : round;
      added = true;
      return Promise.resolve({ manifest: m });
    }
    if (path.endsWith("/prepare")) return Promise.resolve(prepared(path.split("/").at(-2)!));
    return Promise.resolve({ ok: true });
  });
  render(<RoundAdminQueue env="test" title="Ready for the test ballot" />);
  fireEvent.click(await screen.findByRole("button", { name: "Put on the ballot" }));
  await screen.findByText(/Recording Company A/);
  expect(screen.getByRole("button", { name: "Sign Company C's pledge" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sign all" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sign all" }));
  signed(SIG);
  await screen.findByText(/Recording Company C/);
  signed(SIG);
  expect(await screen.findByText("On the ballot.")).toBeInTheDocument();
  expect(calls.filter((c) => c.endsWith("/prepare"))).toEqual([
    `${TEST_QUEUE}/rfp2/${PID_A}/prepare`,
    `${TEST_QUEUE}/rfp2/${PID_C}/prepare`,
  ]);
});

it("RoundAdminQueue: Sign all skips a pledge signed since the list was read", async () => {
  queue = { kind: "real", ready: [], toSign: [item(PID_A), item(PID_C)] };
  let reads = 0;
  const base = vi.mocked(apiFn).getMockImplementation()!;
  vi.mocked(apiFn).mockImplementation((path: string, opts?: unknown) => {
    // The list isn't read again yet: it still shows A after A was signed.
    if (path === QUEUE && reads++ > 0) {
      calls.push(path);
      return new Promise(() => {});
    }
    return base(path, opts as never);
  });
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign Company A's pledge" }));
  const all = screen.getByRole("button", { name: "Sign all" });
  await waitFor(() => expect(all).not.toBeDisabled());
  expect(screen.getByRole("button", { name: "Sign Company A's pledge" })).toBeDisabled();
  fireEvent.click(all);
  await waitFor(() =>
    expect(calls.filter((c) => c.endsWith("/prepare"))).toEqual([
      `${QUEUE}/rfp1/${PID_A}/prepare`,
      `${QUEUE}/rfp1/${PID_C}/prepare`,
    ])
  );
});

it("changeText: a held status change says the status and what goes on-chain", () => {
  expect(
    changeText(item(PID_A, { kind: "edit", amountUsd: 0, fromUsd: 20_000, status: "withdrawn" })),
  )
    .toBe("Withdrawn, $20,000 → $0");
  expect(changeText(item(PID_A, { kind: "add", amountUsd: 0, status: "received" })))
    .toBe("New pledge, Received, $0");
  expect(changeText(item(PID_A, { kind: "edit", amountUsd: 3_000, fromUsd: 2_000 })))
    .toBe("$2,000 → $3,000");
});

it("RoundAdminQueue: an awaiting request shows its last failure and can be discarded", async () => {
  roundAdmin.value = false;
  queue = {
    kind: "real",
    ready: [],
    toSign: [
      item(PID_A, {
        kind: "edit",
        fromUsd: 500,
        by: ADMIN,
        at: 1_800_000_000,
        lastError: "the signature expired",
        lastErrorAt: 1_800_000_100,
      }),
      item(PID_C),
    ],
  };
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  expect(await screen.findByText("Last try failed: the signature expired")).toBeInTheDocument();
  // Only the request has a Discard: a "record" is the row as it stands.
  expect(screen.getAllByRole("button", { name: /Discard/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Discard Company A's awaiting pledge" }));
  await waitFor(() =>
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      `/api/admin/initiatives/rfp1/pledge-requests/${PID_A}`,
      { method: "DELETE" },
    )
  );
});

it(
  "RoundAdminQueue: right after Put on the ballot a pledge the API doesn't see in the round yet is tried again",
  async () => {
    const CONTRACT = "0x2000000000000000000000000000000000000002";
    const TEST_QUEUE = "/api/admin/vote-test-round/queue";
    const round = { ...NO_ROUND, contract: CONTRACT } as typeof NO_ROUND;
    primeRound(round, "test");
    vi.mocked(writeContract).mockReset().mockResolvedValue(
      ("0x" + "12".repeat(32)) as `0x${string}`,
    );
    const r = {
      id: "rfp2",
      slug: "tooling",
      title: "Tooling",
      goalUsd: 20_000,
      raisedUsd: 12_000,
      safeAddress: "0x1000000000000000000000000000000000000001",
      type: "grant" as const,
      affiliations: [],
      pledges: [{ pid: PID_A, company: "Acme", amountUsd: 5_000 }],
      blocker: null,
      claim: null,
    };
    let reads = 0;
    let prepares = 0;
    vi.mocked(api).mockImplementation((path: string) => {
      calls.push(path);
      if (path === TEST_QUEUE) return Promise.resolve({ kind: "test", ready: [r], toSign: [] });
      if (path.startsWith("/api/vote-test/manifest")) {
        return Promise.resolve({
          manifest: reads++ === 0 ? round : {
            ...round,
            slugs: [...round.slugs, "tooling"],
            projects: [...round.projects, { goalUsd: "20000000000", rfp: false, groups: [] }],
          },
        });
      }
      if (path.endsWith("/prepare")) {
        // The API's isolate still reads the round from before the add, once.
        return prepares++ === 0
          ? Promise.reject(new ApiError(404, "That initiative isn't in the round."))
          : Promise.resolve(prepared(PID_A));
      }
      return Promise.resolve({ ok: true });
    });
    render(<RoundAdminQueue env="test" title="Ready for the test ballot" />);
    fireEvent.click(await screen.findByRole("button", { name: "Put on the ballot" }));
    expect(await screen.findByText("On the ballot.", {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(prepares).toBe(2);
  },
  10_000,
);

const claimedRow = (by: string) => ({
  id: "rfp2",
  slug: "tooling",
  title: "Tooling",
  goalUsd: 20_000,
  raisedUsd: 12_000,
  safeAddress: "0x1000000000000000000000000000000000000001",
  type: "grant" as const,
  affiliations: [],
  pledges: [],
  blocker: null,
  claim: { by, at: 1_800_000_000 },
});

it("RoundAdminQueue: an initiative another admin is putting on the ballot says who, button disabled", async () => {
  queue = {
    kind: "real",
    ready: [claimedRow("0x2222222222222222222222222222222222222222")],
    toSign: [],
  };
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  expect(
    await screen.findByText(
      `0x2222…2222 is putting it on the ballot (since ${clock(1_800_000_000)}).`,
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Put on the ballot" })).toBeDisabled();
});

it("RoundAdminQueue: the admin's own claim keeps the button (their run, after a reload)", async () => {
  queue = {
    kind: "real",
    ready: [claimedRow(ADMIN.toUpperCase().replace("0X", "0x"))],
    toSign: [],
  };
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  expect(await screen.findByRole("button", { name: "Put on the ballot" })).not.toBeDisabled();
  expect(screen.queryByText(/is putting it on the ballot/)).toBeNull();
});

it("RoundAdminQueue: Put on the ballot claims first; another admin's claim stops it before the wallet", async () => {
  const r = { ...claimedRow(ADMIN), claim: null };
  vi.mocked(writeContract).mockReset();
  vi.mocked(apiFn).mockImplementation(
    (path: string, opts?: { method?: string; json?: unknown }) => {
      calls.push(`${opts?.method ?? (opts?.json ? "POST" : "GET")} ${path}`);
      if (path === QUEUE) return Promise.resolve({ kind: "real", ready: [r], toSign: [] });
      if (path === "/api/admin/vote-round/ballot-claims/rfp2" && opts?.method !== "DELETE") {
        return Promise.reject(
          new ApiError(
            409,
            "0x2222222222222222222222222222222222222222 is putting it on the ballot.",
            {
              code: "ballot_claimed",
              by: "0x2222222222222222222222222222222222222222",
              at: 1_800_000_000,
            },
          ),
        );
      }
      return Promise.resolve({ ok: true });
    },
  );
  render(<RoundAdminQueue env="production" title="Waiting for a round admin" />);
  fireEvent.click(await screen.findByRole("button", { name: "Put on the ballot" }));
  expect(await screen.findByText("0x2222…2222 is already putting it on the ballot."))
    .toBeInTheDocument();
  expect(writeContract).not.toHaveBeenCalled();
  expect(calls).not.toContain("DELETE /api/admin/vote-round/ballot-claims/rfp2");
});

it("RoundAdminQueue: an add another admin landed first goes on to sign, and says so", async () => {
  const CONTRACT = "0x2000000000000000000000000000000000000002";
  const TEST_QUEUE = "/api/admin/vote-test-round/queue";
  const round = { ...NO_ROUND, contract: CONTRACT } as typeof NO_ROUND;
  primeRound(round, "test");
  // Its own affiliation is added; the initiative is refused as a duplicate.
  vi.mocked(writeContract).mockReset().mockImplementation((_, c) =>
    c.functionName === "addGroup"
      ? Promise.resolve(("0x" + "12".repeat(32)) as `0x${string}`)
      : Promise.reject(
        new Error(
          'The contract function "addInitiative" reverted.\n\nError: DuplicateInitiative()',
        ),
      )
  );
  const r = {
    ...claimedRow(ADMIN),
    claim: null,
    pledges: [{ pid: PID_A, company: "Acme", amountUsd: 5_000 }],
  };
  vi.mocked(apiFn).mockImplementation(
    (path: string, opts?: { method?: string; json?: unknown }) => {
      calls.push(`${opts?.method ?? (opts?.json ? "POST" : "GET")} ${path}`);
      if (path === TEST_QUEUE) return Promise.resolve({ kind: "test", ready: [r], toSign: [] });
      if (path.startsWith("/api/vote-test/manifest")) {
        // Planned before the other admin's add showed; seen once the duplicate is refused.
        const first = calls.filter((c) => c.includes("/api/vote-test/manifest")).length === 1;
        return Promise.resolve({
          manifest: first ? round : {
            ...round,
            slugs: [...round.slugs, "tooling"],
            projects: [...round.projects, { goalUsd: "20000000000", rfp: false, groups: [] }],
          },
        });
      }
      if (path.endsWith("/prepare")) return Promise.resolve(prepared(PID_A));
      return Promise.resolve({ ok: true });
    },
  );
  render(<RoundAdminQueue env="test" title="Ready for the test ballot" />);
  fireEvent.click(await screen.findByRole("button", { name: "Put on the ballot" }));
  expect(await screen.findByText("On the ballot.")).toBeInTheDocument();
  expect(screen.getByText("Another admin already added it.")).toBeInTheDocument();
  expect(screen.queryByText("Added to the round")).toBeNull();
  expect(calls).toContain("POST /api/admin/vote-test-round/ballot-claims/rfp2");
  expect(calls).toContain("DELETE /api/admin/vote-test-round/ballot-claims/rfp2");
  expect(calls.indexOf("POST /api/admin/vote-test-round/ballot-claims/rfp2")).toBeLessThan(
    calls.findIndex((c) => c.includes("/api/vote-test/manifest")),
  );
});
