import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { writeContract } from "wagmi/actions";
import { api } from "~/lib/api";
import { confettiBurst } from "~/components/donate/Celebration";
import TestDonate from "./TestDonate";

const { TOKEN, BETA, ME, ZERO } = vi.hoisted(() => ({
  TOKEN: "0x3000000000000000000000000000000000000003",
  BETA: "0x2000000000000000000000000000000000000002",
  ME: "0x9000000000000000000000000000000000000009",
  ZERO: "0x0000000000000000000000000000000000000000",
}));

vi.mock("../../../shared/vote/manifest", async (original) => ({
  ...await original<typeof import("../../../shared/vote/manifest")>(),
  ROUND: {
    kind: "test",
    chainId: 11155111,
    slugs: ["alpha", "beta"],
    accounts: ["0x1000000000000000000000000000000000000001", BETA],
    currencies: [
      { symbol: "USD", asset: ZERO, usdFeed: ZERO },
      { symbol: "tUSD", asset: TOKEN, usdFeed: ZERO },
    ],
  },
}));
vi.mock("~/components/donate/Celebration", () => ({ confettiBurst: vi.fn() }));
vi.mock("wagmi/actions", () => ({ writeContract: vi.fn() }));
const chain = vi.hoisted(() => ({
  balance: 0n,
  getBalance: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));
vi.mock("~/hooks/use-vote-send", () => ({
  voteClient: () => ({
    getBalance: chain.getBalance,
    waitForTransactionReceipt: chain.waitForTransactionReceipt,
  }),
}));
vi.mock("~/hooks/use-vote-chain", () => ({ useEnsureVoteChain: () => async () => {} }));
vi.mock("~/context/wallet", () => ({
  useWallet: () => ({ address: ME, config: {}, connector: null }),
}));
vi.mock("~/lib/wallet-store", () => ({ liveConnector: () => undefined }));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(confettiBurst).mockClear();
  vi.mocked(writeContract).mockReset().mockResolvedValue("0xabc" as never);
  vi.mocked(api).mockReset().mockResolvedValue({ hash: "0xgas" });
  chain.getBalance.mockReset().mockImplementation(() => Promise.resolve(chain.balance));
  chain.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
  chain.balance = 10n ** 15n;
});

it("mints the amount in test dollars straight to the initiative's account", async () => {
  const onDonated = vi.fn();
  render(
    <TestDonate
      slug="beta"
      suggested={[{ usd: 9000, note: "brings it into S-Tier", label: "to S-Tier" }]}
      onDonated={onDonated}
    />,
  );
  expect(screen.getByText(/No real money moves/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Donate test dollars" }));
  expect(await screen.findByText(/\$9,000 in test dollars is on its account/)).toBeInTheDocument();
  const call = vi.mocked(writeContract).mock.calls[0][1] as unknown as Record<string, unknown>;
  expect(call).toMatchObject({
    address: TOKEN,
    functionName: "mint",
    args: [BETA, 9_000_000_000n],
    chainId: 11155111,
  });
  // The page hears the dollars given, and the field clears for another amount (#100).
  expect(onDonated).toHaveBeenCalledWith(9000);
  expect((screen.getByLabelText("Amount in US dollars") as HTMLInputElement).value).toBe("");
  expect(confettiBurst).toHaveBeenCalledOnce();
  // The wallet had gas: no top-up.
  expect(api).not.toHaveBeenCalled();
});

it("a wallet with no Sepolia ETH asks for its badge's gas first", async () => {
  chain.balance = 0n;
  render(<TestDonate slug="beta" badge={7} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Amount in US dollars" }), {
    target: { value: "25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Donate test dollars" }));
  expect(await screen.findByText(/\$25 in test dollars/)).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/api/vote/gas", {
    method: "POST",
    json: { tokenId: "7" },
  });
});

it("refuses a blank amount and one over a million", async () => {
  render(<TestDonate slug="beta" />);
  const input = screen.getByRole("textbox", { name: "Amount in US dollars" });
  fireEvent.click(screen.getByRole("button", { name: "Donate test dollars" }));
  expect(await screen.findByText("Enter an amount in dollars.")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "1000001" } });
  fireEvent.click(screen.getByRole("button", { name: "Donate test dollars" }));
  expect(await screen.findByText(/A million test dollars at most/)).toBeInTheDocument();
  expect(writeContract).not.toHaveBeenCalled();
  expect(confettiBurst).not.toHaveBeenCalled();
});

it("an initiative the round doesn't have can't be given to", () => {
  render(<TestDonate slug="nope" />);
  expect(screen.getByRole("button", { name: "Donate test dollars" })).toBeDisabled();
});

it("never offers or sends more than the initiative still needs (#102)", () => {
  const cap = { usd: 30_000, note: "all it still needs", label: "to be funded" };
  render(
    <TestDonate
      slug="beta"
      suggested={[{ usd: 4050, note: "brings it into A-Tier", label: "to A-Tier" }]}
      cap={cap}
    />,
  );
  // No $50,000: the last chip is what it needs, labelled.
  expect(screen.queryByRole("button", { name: /50,000/ })).toBeNull();
  expect(screen.getByRole("button", { name: "$30,000, all it still needs" }))
    .toHaveTextContent("to be funded");
  // Typing more is blocked, with the reason.
  fireEvent.change(screen.getByLabelText("Amount in US dollars"), {
    target: { value: "50000" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "It needs $30,000 at most: that funds it fully.",
  );
  expect(screen.getByRole("button", { name: "Donate test dollars" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Amount in US dollars"), {
    target: { value: "30000" },
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Donate test dollars" })).toBeEnabled();
});

it("a new suggestion for the same initiative never moves the amount (#100)", () => {
  const at = (usd: number) => (
    <TestDonate
      slug="beta"
      suggested={[{ usd, note: "brings it into A-Tier", label: "to A-Tier" }]}
    />
  );
  const { rerender } = render(at(4050));
  const amount = () => (screen.getByLabelText("Amount in US dollars") as HTMLInputElement).value;
  expect(amount()).toBe("4050");
  rerender(at(3000));
  expect(amount()).toBe("4050");
});

it("preselect false: the field starts empty and suggestions don't fill it", () => {
  const at = (usds: number[]) => (
    <TestDonate
      slug="beta"
      suggested={usds.map((usd) => ({ usd, note: "no threat found", label: "No threat found" }))}
      preselect={false}
    />
  );
  const { rerender } = render(at([2000, 10_000]));
  const amount = () => (screen.getByLabelText("Amount in US dollars") as HTMLInputElement).value;
  expect(amount()).toBe("");
  expect(screen.getByRole("button", { name: "$2,000, no threat found" })).toBeInTheDocument();
  rerender(at([3000, 12_000]));
  expect(amount()).toBe("");
});
