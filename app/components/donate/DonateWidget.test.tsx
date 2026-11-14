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
