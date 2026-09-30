import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import DonateWidget from "./DonateWidget";

const mock = vi.hoisted(() => ({
  recordAcceptance: vi.fn(),
  confirmTx: vi.fn(),
  setStatus: vi.fn(),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({}) }));
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
