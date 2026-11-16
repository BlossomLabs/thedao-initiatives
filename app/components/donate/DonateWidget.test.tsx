import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import DonateWidget, { EXAMPLE_NOTE } from "./DonateWidget";

const mock = vi.hoisted(() => ({
  recordAcceptance: vi.fn(),
  confirmTx: vi.fn(),
  setStatus: vi.fn(),
}));
vi.mock("~/context/wallet", () => ({
  useWallet: () => ({}),
  useWalletStore: () => ({ load: () => Promise.resolve({ config: {} }) }),
}));
vi.mock("~/lib/wallet-env", () => ({ WALLETCONNECT_PROJECT_ID: "" }));
const params = vi.hoisted(() => ({
  enabled: true,
  tokens: { USDC: { address: "token", decimals: 6 } },
  rates: { USDC: 1 },
}));
vi.mock("~/hooks/use-donate-params", () => ({ useDonateParams: () => ({ data: params }) }));
vi.mock(
  "./useDonation",
  () => ({
    useDonation: () => ({
      ...mock,
      busy: null,
      status: null,
      donate: vi.fn(),
      loadBalances: () => Promise.resolve({}),
    }),
  }),
);
vi.mock("~/components/terms/GovernedBy", () => ({ default: () => null }));
const SAFE = "0x3333333333333333333333333333333333333333";
const renderWidget = () =>
  render(
    <MemoryRouter>
      <DonateWidget initiativeId="id" slug="test" safeAddress={SAFE} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

it("keeps the address hidden until the checked acceptance is persisted, with every optional field blank", async () => {
  let finish!: (value: unknown) => void;
  mock.recordAcceptance.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderWidget();
  const button = screen.getByRole("button", { name: "Show donation address" });
  expect(button).toBeDisabled();
  expect(screen.queryByText(SAFE)).toBeNull();
  expect(screen.getByLabelText("Currency (optional)")).toHaveTextContent("Not specified");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.queryByText(SAFE)).toBeNull();
  fireEvent.click(button);
  expect(mock.recordAcceptance).toHaveBeenCalledWith("exchange", {});
  expect(screen.queryByText(SAFE)).toBeNull();
  await act(() => Promise.resolve(finish({ attemptId: "attempt" })));
  expect(screen.getByText(SAFE)).toBeInTheDocument();
  const hash = "0x" + "aa".repeat(32);
  fireEvent.change(screen.getByLabelText("Transaction hash after withdrawal (optional)"), {
    target: { value: hash },
  });
  fireEvent.click(screen.getByRole("button", { name: "Match my deposit" }));
  expect(mock.confirmTx).toHaveBeenCalledWith(hash, "attempt");
});

it("keeps the address hidden after a recording failure and sends optional details only when supplied", async () => {
  mock.recordAcceptance.mockRejectedValue(new Error("offline"));
  renderWidget();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Donor" } });
  await act(() =>
    Promise.resolve(fireEvent.click(screen.getByRole("button", { name: "Show donation address" })))
  );
  expect(mock.recordAcceptance).toHaveBeenCalledWith("exchange", { name: "Donor" });
  expect(screen.queryByText(SAFE)).toBeNull();
  expect(mock.setStatus).toHaveBeenCalledWith({ kind: "err", text: "Offline." });
});

it("starts from a suggested amount, in order among the chips, and reports the amount", () => {
  const onAmount = vi.fn();
  render(
    <MemoryRouter>
      <DonateWidget
        initiativeId="id"
        slug="test"
        safeAddress={SAFE}
        suggested={{ usd: 8412, note: "gets it into S-Tier" }}
        onAmount={onAmount}
        accent="red"
      />
    </MemoryRouter>,
  );
  // No wallet in the test browser: the exchange tab leads.
  fireEvent.click(screen.getByText("Wallet"));
  expect(screen.getByLabelText("Amount in US dollars")).toHaveValue("8412");
  const chip = screen.getByRole("button", { name: "$8,412, gets it into S-Tier" });
  // Among the usual amounts, in order.
  expect(screen.getAllByRole("button", { name: /^\$[\d,]+/ }).map((b) => b.textContent))
    .toEqual(["$500", "$5,000", "$8,412", "$50,000"]);
  // Red, like the vote results' red numbers and buttons.
  expect(chip.className).toContain("bg-dao-red");
  expect(screen.queryByRole("button", { name: "$50" })).toBeNull();
  expect(onAmount).toHaveBeenLastCalledWith(8412);
  fireEvent.click(screen.getByRole("button", { name: "$500" }));
  expect(onAmount).toHaveBeenLastCalledWith(500);
});

it("suggests several amounts, each labelled, the first picked", () => {
  render(
    <MemoryRouter>
      <DonateWidget
        initiativeId="id"
        slug="test"
        safeAddress={SAFE}
        suggested={[
          { usd: 3000, note: "brings it into B-Tier", label: "to B-Tier" },
          { usd: 12000, note: "brings it into A-Tier", label: "to A-Tier" },
          { usd: 41000, note: "brings it into S-Tier", label: "to S-Tier" },
        ]}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Wallet"));
  expect(screen.getByLabelText("Amount in US dollars")).toHaveValue("3000");
  // The three, then the usual amounts after the smallest, four in all.
  const chips = [
    "$3,000, brings it into B-Tier",
    "$12,000, brings it into A-Tier",
    "$41,000, brings it into S-Tier",
  ]
    .map((name) => screen.getByRole("button", { name }));
  expect(chips[1]).toHaveTextContent("$12,000to A-Tier");
  expect(screen.queryByRole("button", { name: "$5,000" })).toBeNull();
  // Smallest first, whatever they are; the first suggestion stays picked.
  const order = screen.getAllByRole("button", { name: /^\$[\d,]+/ }).map((b) => b.textContent);
  expect(order).toEqual(["$500", "$3,000to B-Tier", "$12,000to A-Tier", "$41,000to S-Tier"]);
  expect(chips[0].className).toContain("bg-dao-green");
});

it("with a cap, no chip goes past it, the last one is it, and more can't be sent (#102)", () => {
  render(
    <MemoryRouter>
      <DonateWidget
        initiativeId="id"
        slug="test"
        safeAddress={SAFE}
        suggested={[{ usd: 4050, note: "brings it into A-Tier", label: "to A-Tier" }]}
        cap={{ usd: 30_000, note: "all it still needs", label: "to be funded" }}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Wallet"));
  const order = screen.getAllByRole("button", { name: /^\$[\d,]+/ }).map((b) => b.textContent);
  expect(order).toEqual(["$500", "$4,050to A-Tier", "$5,000", "$30,000to be funded"]);
  // The suggestion stays picked, not the cap.
  expect(screen.getByLabelText("Amount in US dollars")).toHaveValue("4050");
  fireEvent.click(screen.getByRole("checkbox"));
  const donate = screen.getByRole("button", { name: "Donate" });
  expect(donate).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Amount in US dollars"), {
    target: { value: "50000" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "It needs $30,000 at most: that funds it fully.",
  );
  expect(donate).toBeDisabled();
});

it("on an example page, Donate and the address only say nothing is donated", () => {
  render(
    <MemoryRouter>
      <DonateWidget initiativeId="id" slug="test" safeAddress={SAFE} example />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("checkbox"));
  // The exchange tab leads without a wallet: its button records nothing.
  fireEvent.click(screen.getByRole("button", { name: "Show donation address" }));
  expect(mock.recordAcceptance).not.toHaveBeenCalled();
  expect(mock.setStatus).toHaveBeenLastCalledWith({ kind: "wait", text: EXAMPLE_NOTE });
  expect(screen.queryByText(SAFE)).toBeNull();
  mock.setStatus.mockClear();
  fireEvent.click(screen.getByText("Wallet"));
  fireEvent.click(screen.getByRole("button", { name: "Donate" }));
  expect(mock.setStatus).toHaveBeenLastCalledWith({ kind: "wait", text: EXAMPLE_NOTE });
});

it("a new suggestion (the round changed on-chain) never moves the amount: it stays what was offered or typed (#100)", () => {
  const at = (usd: number | undefined, initiativeId = "id") => (
    <MemoryRouter>
      <DonateWidget
        initiativeId={initiativeId}
        slug="test"
        safeAddress={SAFE}
        suggested={usd === undefined ? undefined : { usd, note: "gets it into S-Tier" }}
      />
    </MemoryRouter>
  );
  const { rerender } = render(at(undefined));
  // No wallet in the test browser: the exchange tab leads.
  fireEvent.click(screen.getByText("Wallet"));
  const amount = () => (screen.getByLabelText("Amount in US dollars") as HTMLInputElement).value;
  expect(amount()).toBe("");
  // The first suggestion arrives after the form opened: it fills the empty field once.
  rerender(at(9000));
  expect(amount()).toBe("9000");
  // Somebody else voted: the gap is smaller now. The amount stays; the chip shows the new one.
  rerender(at(8000));
  expect(amount()).toBe("9000");
  expect(screen.getByRole("button", { name: /\$8,000/ })).toBeInTheDocument();
  // Typed: it stays too.
  fireEvent.change(screen.getByLabelText("Amount in US dollars"), { target: { value: "5000" } });
  rerender(at(7000));
  expect(amount()).toBe("5000");
  // Another initiative starts from its own suggestion.
  rerender(at(3000, "other"));
  expect(amount()).toBe("3000");
});

it("preselect false: the field starts empty and suggestions don't fill it", () => {
  const at = (usds: number[]) => (
    <MemoryRouter>
      <DonateWidget
        initiativeId="id"
        slug="test"
        safeAddress={SAFE}
        suggested={usds.map((usd) => ({
          usd,
          note: "in S-Tier in the scenarios checked",
          label: "In S-Tier",
        }))}
        preselect={false}
      />
    </MemoryRouter>
  );
  const { rerender } = render(at([2000, 10_000]));
  fireEvent.click(screen.getByText("Wallet"));
  const amount = () => (screen.getByLabelText("Amount in US dollars") as HTMLInputElement).value;
  expect(amount()).toBe("");
  // The suggestions are chips all the same.
  expect(screen.getByRole("button", { name: "$2,000, in S-Tier in the scenarios checked" }))
    .toBeInTheDocument();
  rerender(at([3000, 12_000]));
  expect(amount()).toBe("");
});
