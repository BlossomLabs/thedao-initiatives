import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ConnectInline from "./ConnectInline";

const state = vi.hoisted(() => ({
  isConnected: false,
  connecting: false,
  signingIn: false,
  connect: vi.fn(),
  signIn: vi.fn(),
  openWalletPicker: vi.fn(),
  walletPickerOpen: false,
}));

vi.mock("wagmi", () => ({ useAccount: () => state }));
vi.mock("~/context/session", () => ({ useSession: () => state }));
vi.mock("~/context/wallet-picker", () => ({ useWalletPicker: () => state }));

beforeEach(() => {
  state.isConnected = false;
  state.connecting = false;
  state.signingIn = false;
  state.connect.mockReset().mockResolvedValue(undefined);
  state.signIn.mockReset().mockResolvedValue(undefined);
  state.openWalletPicker.mockReset();
});
afterEach(cleanup);

it("opens the chooser for a connected wallet without a session, so another wallet or email stays reachable", () => {
  state.isConnected = true;
  render(<ConnectInline />);
  const button = screen.getByRole("button", { name: "Sign in" });
  expect(button).toHaveAttribute("aria-haspopup", "dialog");
  fireEvent.click(button);
  expect(state.openWalletPicker).toHaveBeenCalledOnce();
  expect(state.signIn).not.toHaveBeenCalled();
});

it.each(["connecting", "signingIn"] as const)("disables sign-in while %s", (busy) => {
  state.isConnected = true;
  state[busy] = true;
  render(<ConnectInline />);
  const button = screen.getByRole("button", { name: "Check your wallet…" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(state.signIn).not.toHaveBeenCalled();
});

it("still opens the shared wallet chooser for a disconnected user", () => {
  render(<ConnectInline />);
  const button = screen.getByRole("button", { name: "Connect wallet" });
  expect(button).toHaveAttribute("aria-haspopup", "dialog");
  fireEvent.click(button);
  expect(state.openWalletPicker).toHaveBeenCalledOnce();
  expect(state.signIn).not.toHaveBeenCalled();
});

it("reopens the chooser while a pairing is in flight instead of locking the button", () => {
  state.connecting = true;
  render(<ConnectInline />);
  const button = screen.getByRole("button", { name: "Check your wallet…" });
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  expect(state.openWalletPicker).toHaveBeenCalledOnce();
});
