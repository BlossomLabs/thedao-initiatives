import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ConnectInline from "./ConnectInline";

const state = vi.hoisted(() => ({
  isConnected: false,
  connecting: false,
  signingIn: false,
  connect: vi.fn(),
  signIn: vi.fn(),
  connectors: [
    { id: "io.metamask", uid: "metamask", name: "MetaMask" },
    { id: "io.rabby", uid: "rabby", name: "Rabby" },
  ],
}));

vi.mock("wagmi", () => ({ useAccount: () => state }));
vi.mock("~/context/session", () => ({ useSession: () => state }));
vi.mock("~/hooks/use-connectors", () => ({ useConnectors: () => state.connectors }));
vi.mock("~/context/email-sign-in", () => ({
  useEmailSignIn: () => ({ openEmailSignIn: vi.fn() }),
}));
vi.mock("~/lib/privy", () => ({ PRIVY_CONNECTOR_ID: "privy" }));

beforeEach(() => {
  state.isConnected = false;
  state.connecting = false;
  state.signingIn = false;
  state.connect.mockReset().mockResolvedValue(undefined);
  state.signIn.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it("signs in with the connected wallet without opening another wallet picker", async () => {
  state.isConnected = true;
  render(<ConnectInline />);
  const button = screen.getByRole("button", { name: "Sign in" });
  expect(button).not.toHaveAttribute("aria-haspopup");
  fireEvent.click(button);
  await waitFor(() => expect(state.signIn).toHaveBeenCalledOnce());
  expect(state.connect).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("shows a refused signature and allows a retry on the same connection", async () => {
  state.isConnected = true;
  state.signIn.mockRejectedValueOnce(Object.assign(new Error("User rejected request"), {
    code: 4001,
  }));
  render(<ConnectInline />);
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in failed:");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(state.signIn).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(state.connect).not.toHaveBeenCalled();
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

it("still lets a disconnected user pick their wallet", async () => {
  render(<ConnectInline />);
  fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "MetaMask" }));
  await waitFor(() => expect(state.connect).toHaveBeenCalledWith(state.connectors[0]));
  expect(state.signIn).not.toHaveBeenCalled();
});
