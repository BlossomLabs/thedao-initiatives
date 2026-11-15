import { type ReactElement, useState } from "react";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { signTypedData } from "wagmi/actions";
import { api, ApiError } from "~/lib/api";
import Pledges, { PledgeForm } from "./Pledges";
import type { AdminInitiativePage } from "~/lib/api-types";
import type { Run } from "./run";

const ADMIN = "0x1111111111111111111111111111111111111111";
const BASE = "/api/admin/initiatives/1";
const SIG = ("0x" + "ab".repeat(65)) as `0x${string}`;
const HASH = ("0x" + "cd".repeat(32)) as `0x${string}`;
const waitReceipt = vi.fn();

vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: ADMIN, isConnected: true, config: {}, connectors: [] }),
}));
vi.mock("~/hooks/use-vote-chain", () => ({ useEnsureVoteChain: () => () => Promise.resolve() }));
vi.mock("wagmi/actions", () => ({ signTypedData: vi.fn() }));
vi.mock("~/hooks/use-vote-send", () => ({
  voteClient: () => ({ waitForTransactionReceipt: waitReceipt }),
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

const prepared = {
  pid: "01JPLEDGE0000000000000000A",
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
      initiativeId: "1",
      currencyId: "0",
      amount: "500000000",
      nonce: "3",
      deadline: "1800000600",
    },
  },
};

const needsSignature = () =>
  new ApiError(
    428,
    "During the vote a pledge is recorded on-chain first: sign it with your wallet.",
    {
      code: "signature_required",
    },
  );

const render = (ui: ReactElement) => {
  const qc = new QueryClient();
  const out = rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return {
    ...out,
    rerender: (next: ReactElement) =>
      out.rerender(<QueryClientProvider client={qc}>{next}</QueryClientProvider>),
  };
};

/** The form with a run like the admin page's: the failure's message under the form. */
function Harness({ base = BASE }: { base?: string }) {
  const [msg, setMsg] = useState("");
  const run: Run = async (fn, ok) => {
    setMsg("");
    try {
      const result = await fn();
      setMsg((typeof ok === "function" ? ok(result) : ok) ?? "");
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    }
  };
  return (
    <>
      <PledgeForm base={base} run={run} editing={null} onDone={() => {}} />
      <p data-testid="msg">{msg}</p>
    </>
  );
}

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("Company *"), { target: { value: "Acme" } });
  fireEvent.change(screen.getByPlaceholderText("Amount USD *"), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "Add pledge" }));
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(signTypedData).mockReset().mockResolvedValue(SIG);
  waitReceipt.mockReset().mockResolvedValue({ status: "success" });
});

it("asks for a signature, resubmits with it, waits for the receipt itself, then settles", async () => {
  let mined!: (v: unknown) => void;
  waitReceipt.mockImplementation(() => new Promise((r) => (mined = r)));
  let posts = 0;
  vi.mocked(api).mockImplementation((path) => {
    if (path === `${BASE}/pledges/prepare`) return Promise.resolve(prepared);
    if (path === `${BASE}/pledges`) {
      posts++;
      // Answered right after the broadcast, with the hash.
      return posts === 1 ? Promise.reject(needsSignature()) : Promise.resolve({
        hash: HASH,
        pid: prepared.pid,
      });
    }
    if (path === `${BASE}/pledges/${prepared.pid}/settle`) {
      return Promise.resolve({ state: "saved", pledge: {} });
    }
    return Promise.reject(new Error("unexpected " + path));
  });
  render(<Harness />);
  fill();
  expect(await screen.findByText(/^Waiting for .+ to record it/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^0xcdcd…cdcd on / })).toHaveAttribute(
    "href",
    expect.stringContaining(`/tx/${HASH}`),
  );
  expect(waitReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH }));
  // The typed data the API built, with its numbers back to bigints, signed by the admin.
  const signed = vi.mocked(signTypedData).mock.calls[0][1] as unknown as {
    account: string;
    message: Record<string, unknown>;
  };
  expect(signed.account).toBe(ADMIN);
  expect(signed.message).toMatchObject({ amount: 500_000_000n, nonce: 3n, initiativeId: 1n });
  const prepareCall = vi.mocked(api).mock.calls.find(([p]) => p === `${BASE}/pledges/prepare`)!;
  expect(prepareCall[1]?.json).toMatchObject({ company: "Acme", amount: "500" });
  const resent = vi.mocked(api).mock.calls.filter(([p]) => p === `${BASE}/pledges`)[1][1]!.form!;
  expect(resent.get("company")).toBe("Acme");
  expect(resent.get("pid")).toBe(prepared.pid);
  expect(resent.get("nonce")).toBe("3");
  expect(resent.get("deadline")).toBe("1800000600");
  expect(resent.get("signature")).toBe(SIG);
  mined({ status: "success" });
  await waitFor(() => expect(screen.getByTestId("msg")).toHaveTextContent("Pledge added."));
  const settle = vi.mocked(api).mock.calls.find(([p]) => String(p).endsWith("/settle"))!;
  expect(settle[1]?.json).toEqual({ hash: HASH });
  expect(screen.queryByText(/^Waiting for/)).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("Company *")).toHaveValue("");
});

it("shows the signing step while the wallet asks", async () => {
  vi.mocked(signTypedData).mockImplementation(() => new Promise(() => {}));
  vi.mocked(api).mockImplementation((path) =>
    path === `${BASE}/pledges/prepare`
      ? Promise.resolve(prepared)
      : Promise.reject(needsSignature())
  );
  render(<Harness />);
  fill();
  expect(await screen.findByText(/Sign the pledge in your wallet/)).toBeInTheDocument();
});

it("a receipt that takes too long says so with the hash, and keeps the form filled", async () => {
  waitReceipt.mockRejectedValue(new Error("timed out"));
  let posts = 0;
  vi.mocked(api).mockImplementation((path) => {
    if (path === `${BASE}/pledges/prepare`) return Promise.resolve(prepared);
    posts++;
    return posts === 1
      ? Promise.reject(needsSignature())
      : Promise.resolve({ hash: HASH, pid: prepared.pid });
  });
  render(<Harness />);
  fill();
  await waitFor(() =>
    expect(screen.getByTestId("msg")).toHaveTextContent("It's taking too long to be mined.")
  );
  expect(screen.getByText(/is taking long\. It was sent and may still land/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^0xcdcd…cdcd on / })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Company *")).toHaveValue("Acme");
});

it("a reverted transaction says it failed on-chain, and keeps the form filled", async () => {
  waitReceipt.mockResolvedValue({ status: "reverted" });
  let posts = 0;
  vi.mocked(api).mockImplementation((path) => {
    if (path === `${BASE}/pledges/prepare`) return Promise.resolve(prepared);
    if (String(path).endsWith("/settle")) return Promise.resolve({ state: "failed" });
    posts++;
    return posts === 1
      ? Promise.reject(needsSignature())
      : Promise.resolve({ hash: HASH, pid: prepared.pid });
  });
  render(<Harness />);
  fill();
  await waitFor(() =>
    expect(screen.getByTestId("msg")).toHaveTextContent("The transaction failed on-chain.")
  );
  expect(screen.getByPlaceholderText("Amount USD *")).toHaveValue("500");
});

it("shows the failure and keeps the form filled when the chain refuses", async () => {
  let posts = 0;
  vi.mocked(api).mockImplementation((path) => {
    if (path === `${BASE}/pledges/prepare`) return Promise.resolve(prepared);
    posts++;
    if (posts === 1) return Promise.reject(needsSignature());
    return Promise.reject(
      new ApiError(
        502,
        "The pledge wasn't recorded on-chain, so nothing was saved: the transaction reverted.",
        { code: "pledge_not_recorded" },
      ),
    );
  });
  render(<Harness />);
  fill();
  await waitFor(() =>
    expect(screen.getByTestId("msg")).toHaveTextContent(
      "The pledge wasn't recorded on-chain, so nothing was saved",
    )
  );
  expect(screen.getByPlaceholderText("Company *")).toHaveValue("Acme");
  expect(screen.getByPlaceholderText("Amount USD *")).toHaveValue("500");
  // Sent again: the same pledge id, so it is never a second pledge on-chain.
  posts = 0;
  fireEvent.click(screen.getByRole("button", { name: "Add pledge" }));
  await waitFor(() => expect(vi.mocked(signTypedData)).toHaveBeenCalledTimes(2));
  const prepares = vi.mocked(api).mock.calls.filter(([p]) => p === `${BASE}/pledges/prepare`);
  expect(prepares[1][1]?.json).toMatchObject({ pid: prepared.pid });
});

const pendingErr = () =>
  new ApiError(409, "This pledge's last change is still being recorded on-chain.", {
    code: "pledge_pending",
    hash: HASH,
    pid: prepared.pid,
  });

it("a 409 pledge_pending waits for the earlier change, says so, and keeps the form", async () => {
  let mined!: (v: unknown) => void;
  waitReceipt.mockImplementation(() => new Promise((r) => (mined = r)));
  vi.mocked(api).mockImplementation((path) => {
    if (path === `${BASE}/pledges/prepare`) return Promise.reject(pendingErr());
    if (String(path).endsWith("/settle")) return Promise.resolve({ state: "saved" });
    return Promise.reject(needsSignature());
  });
  render(<Harness />);
  fill();
  expect(await screen.findByText(/An earlier change to this pledge is on its way/))
    .toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^0xcdcd…cdcd on / })).toBeInTheDocument();
  mined({ status: "success" });
  await waitFor(() =>
    expect(screen.getByTestId("msg")).toHaveTextContent(
      "An earlier change to this pledge was just recorded.",
    )
  );
  expect(vi.mocked(signTypedData)).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText("Company *")).toHaveValue("Acme");
});

it("a 409 for the same new pledge sent again: it landed, so the form clears", async () => {
  let prepares = 0;
  vi.mocked(api).mockImplementation((path) => {
    if (path === `${BASE}/pledges/prepare`) {
      return ++prepares === 1 ? Promise.resolve(prepared) : Promise.reject(pendingErr());
    }
    if (String(path).endsWith("/settle")) return Promise.resolve({ state: "saved" });
    const call = vi.mocked(api).mock.calls.filter(([p]) => p === `${BASE}/pledges`).length;
    return call === 2
      ? Promise.reject(new ApiError(503, "The vote relayer is busy; try again in a moment."))
      : Promise.reject(needsSignature());
  });
  render(<Harness />);
  fill();
  await waitFor(() => expect(screen.getByTestId("msg")).toHaveTextContent("relayer is busy"));
  fireEvent.click(screen.getByRole("button", { name: "Add pledge" }));
  await waitFor(() => expect(screen.getByTestId("msg")).toHaveTextContent("Pledge added."));
  expect(screen.getByPlaceholderText("Company *")).toHaveValue("");
});

it("a new pledge for another initiative gets its own pledge id", async () => {
  let posts = 0;
  vi.mocked(api).mockImplementation((path) => {
    if (String(path).endsWith("/pledges/prepare")) return Promise.resolve(prepared);
    posts++;
    if (posts % 2 === 1) return Promise.reject(needsSignature());
    return Promise.reject(new ApiError(502, "not recorded", { code: "pledge_not_recorded" }));
  });
  const { rerender } = render(<Harness />);
  fill();
  await waitFor(() => expect(screen.getByTestId("msg")).toHaveTextContent("not recorded"));
  rerender(<Harness base="/api/admin/initiatives/2" />);
  fireEvent.click(screen.getByRole("button", { name: "Add pledge" }));
  await waitFor(() => expect(vi.mocked(signTypedData)).toHaveBeenCalledTimes(2));
  const prepares = vi.mocked(api).mock.calls.filter(([p]) => String(p).endsWith("/prepare"));
  expect(prepares[1][0]).toBe("/api/admin/initiatives/2/pledges/prepare");
  expect((prepares[1][1]?.json as { pid?: string }).pid).toBeUndefined();
});

it("shows pledges still being recorded on-chain in the table", () => {
  const pledge = {
    id: "P1",
    company: "Acme",
    amountUsd: 500,
    status: "pledged",
    note: "",
    url: "",
    logoUrl: "",
  };
  const page = {
    pledges: [pledge],
    pendingPledges: [
      { pid: "P1", kind: "edit", company: null, amountUsd: null, hash: "0x01" },
      { pid: "P2", kind: "add", company: "Newco", amountUsd: 300, hash: "0x02" },
    ],
  } as unknown as AdminInitiativePage;
  render(<Pledges page={page} base={BASE} run={() => Promise.resolve(true)} />);
  expect(screen.getAllByText("Recording on-chain…")).toHaveLength(2);
  expect(screen.getByText("Newco")).toBeInTheDocument();
  // An edit in flight can't be edited or deleted again until it lands.
  expect(screen.queryByTitle("Delete pledge")).not.toBeInTheDocument();
});
