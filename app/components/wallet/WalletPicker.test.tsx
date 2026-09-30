import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { Connector } from "wagmi";
import WalletPicker from "./WalletPicker";
import { walletStore } from "~/lib/wallet-store";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  cancelPairing: vi.fn(() => true),
  email: vi.fn(),
  connectors: [] as Connector[],
  connecting: false,
  signingIn: false,
  restoring: false,
}));
vi.mock("~/context/session", () => ({ useSession: () => mocks }));
vi.mock(
  "~/context/email-sign-in",
  () => ({ useEmailSignIn: () => ({ openEmailSignIn: mocks.email }) }),
);
vi.mock("~/hooks/use-connectors", () => ({ useConnectors: () => mocks.connectors }));
vi.mock("~/lib/privy-store", () => ({ PRIVY_APP_ID: "app", PRIVY_CONNECTOR_ID: "privy" }));
vi.mock("~/lib/wallet-env", () => ({ MOCK_WALLET: undefined, WALLETCONNECT_PROJECT_ID: "wc" }));

const uri = "wc:test-topic@2?relay-protocol=irn&symKey=abc123";
type Message = { type: string; data?: unknown };
const listeners = new Set<(message: Message) => void>();
const wc = {
  id: "walletConnect",
  uid: "wc",
  name: "WalletConnect",
  emitter: {
    on: vi.fn((_event, fn) => listeners.add(fn)),
    off: vi.fn((_event, fn) => listeners.delete(fn)),
  },
} as unknown as Connector;
const injected = { id: "io.rabby", uid: "rabby", name: "Rabby", type: "injected" } as Connector;
const email = { id: "privy", uid: "email", name: "Email" } as Connector;
let resolve: () => void;
let reject: (error: Error) => void;
let pending: Promise<void>;
const fetched = vi.fn();
const copied = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  walletStore.setSnapshot({ attached: true, failed: null });
  listeners.clear();
  mocks.connectors = [injected, email, wc];
  mocks.connecting = false;
  mocks.signingIn = false;
  mocks.restoring = false;
  pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  mocks.connect.mockImplementation(() => pending);
  fetched.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        wallets: [
          { id: "meta", name: "MetaMask", native: "metamask://", universal: null },
          { id: "rainbow", name: "Rainbow", native: "rainbow://", universal: null },
          { id: "other", name: "Other Wallet", native: null, universal: null },
        ],
      }),
  });
  copied.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetched);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copied },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function pairing() {
  const onOpenChange = vi.fn();
  const view = render(<WalletPicker open onOpenChange={onOpenChange} />);
  fireEvent.click(screen.getByRole("button", { name: /Mobile wallets/ }));
  await screen.findByRole("button", { name: "Rainbow" });
  return { ...view, onOpenChange };
}
function ready() {
  act(() => listeners.forEach((fn) => fn({ type: "display_uri", data: uri })));
}

test("offers different app links from one pairing, search, and an unrestricted QR fallback", async () => {
  await pairing();
  expect(screen.getByRole("button", { name: "Rainbow" })).toBeDisabled();
  ready();
  expect(screen.getByRole("link", { name: "MetaMask" })).toHaveAttribute(
    "href",
    `metamask://wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(screen.getByRole("link", { name: "Rainbow" })).toHaveAttribute(
    "href",
    `rainbow://wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(mocks.connect).toHaveBeenCalledExactlyOnceWith(wc);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "RAIN" } });
  expect(screen.queryByRole("link", { name: "MetaMask" })).toBeNull();
  expect(screen.getByRole("link", { name: "Rainbow" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "QR code / copy" }));
  expect(await screen.findByTitle("WalletConnect pairing QR code")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy connection URI" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(copied).toHaveBeenCalledWith(uri);
  expect(fetched).toHaveBeenCalledExactlyOnceWith("/wallets.json", expect.anything());
});

test("closing and reopening retains the pairing, and cleanup removes its listener", async () => {
  const { rerender, onOpenChange, unmount } = await pairing();
  ready();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  rerender(<WalletPicker open={false} onOpenChange={onOpenChange} />);
  rerender(<WalletPicker open onOpenChange={onOpenChange} />);
  expect(screen.getByRole("link", { name: "Rainbow" })).toHaveAttribute(
    "href",
    expect.stringContaining("rainbow://wc"),
  );
  expect(mocks.connect).toHaveBeenCalledTimes(1);
  unmount();
  expect(listeners.size).toBe(0);
});

test("keeps the wallet accessible during SIWE and closes only after sign-in finishes", async () => {
  const { rerender, onOpenChange } = await pairing();
  ready();
  // Prevent jsdom navigation while still exercising selection.
  const link = screen.getByRole("link", { name: "Rainbow" });
  link.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(link);
  mocks.signingIn = true;
  rerender(<WalletPicker open onOpenChange={onOpenChange} />);
  expect(screen.getByText(/Approve the sign-in message/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Rainbow" })).toHaveAttribute("href", "rainbow://");
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => {
    resolve();
    await pending;
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(listeners.size).toBe(0);
});

test("rejection clears the old URI and allows a fresh attempt without duplicate listeners", async () => {
  await pairing();
  ready();
  await act(async () => {
    reject(new Error("User rejected the request"));
    await pending.catch(() => {});
  });
  expect(screen.getByRole("alert")).toHaveTextContent(/Not connected/);
  expect(screen.queryByRole("link", { name: "Rainbow" })).toBeNull();
  expect(listeners.size).toBe(0);
  mocks.connect.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  expect(listeners.size).toBe(1);
});

test("directory failure leaves QR and copy functional", async () => {
  fetched.mockRejectedValueOnce(new Error("offline"));
  render(<WalletPicker open onOpenChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Mobile wallets/ }));
  await screen.findByText(/wallet list could not load/);
  ready();
  fireEvent.click(screen.getByRole("button", { name: "QR code / copy" }));
  expect(screen.getByRole("button", { name: "Copy connection URI" })).toBeEnabled();
});

test("offers installed and email wallets without a branded browser fallback", () => {
  mocks.connectors = [injected, email];
  const onOpenChange = vi.fn();
  render(<WalletPicker open onOpenChange={onOpenChange} />);
  expect(screen.getByRole("button", { name: "Rabby" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Email" }));
  expect(mocks.email).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.queryByRole("link", { name: "Open in MetaMask browser" })).not.toBeInTheDocument();
  // No WalletConnect project id: the mobile / QR entry is not offered at all.
  expect(screen.queryByRole("button", { name: /Mobile wallets/ })).not.toBeInTheDocument();
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("does not create overlapping requests from repeated clicks", () => {
  render(<WalletPicker open onOpenChange={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Rabby" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.connect).toHaveBeenCalledExactlyOnceWith(injected);
  expect(screen.getByRole("button", { name: /Mobile wallets/ })).toBeDisabled();
});

test("a pending QR pairing leaves the other methods available, and picking one drops it", async () => {
  await pairing();
  ready();
  mocks.connecting = true;
  fireEvent.click(screen.getByRole("button", { name: /All connection methods/ }));
  expect(screen.getByRole("button", { name: /Continue wallet connection/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Email" })).toBeEnabled();
  expect(screen.getByText(/pick another method to drop it/)).toBeInTheDocument();
  mocks.connect.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Rabby" }));
  expect(mocks.cancelPairing).toHaveBeenCalledTimes(1);
  expect(mocks.connect).toHaveBeenLastCalledWith(injected);
  expect(listeners.size).toBe(0);
  // The dropped pairing settling later neither closes the chooser nor shows an error.
  await act(async () => {
    reject(new Error("Connection cancelled."));
    await pending.catch(() => {});
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Email" })).toBeDisabled();
});

test("a QR wallet's pending sign-in leaves the other methods available, and picking one cancels it", async () => {
  // A WalletConnect sign-in can wait unanswered for a wallet that dropped the session.
  const { rerender, onOpenChange } = await pairing();
  ready();
  mocks.signingIn = true;
  rerender(<WalletPicker open onOpenChange={onOpenChange} />);
  fireEvent.click(screen.getByRole("button", { name: /All connection methods/ }));
  expect(screen.getByRole("button", { name: "Email" })).toBeEnabled();
  mocks.connect.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Rabby" }));
  expect(mocks.cancelPairing).toHaveBeenCalledTimes(1);
  expect(mocks.connect).toHaveBeenLastCalledWith(injected);
});

test("a QR wallet's pending sign-in can be dropped for a new pairing", async () => {
  const { rerender, onOpenChange } = await pairing();
  ready();
  mocks.signingIn = true;
  rerender(<WalletPicker open onOpenChange={onOpenChange} />);
  mocks.connect.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Start a new connection" }));
  expect(mocks.cancelPairing).toHaveBeenCalledTimes(1);
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  expect(mocks.connect).toHaveBeenLastCalledWith(wc);
  expect(listeners.size).toBe(1);
});

test("waits for a wallet connection being restored before offering any method", () => {
  // A restore finishing after another wallet connected would replace that wallet.
  mocks.restoring = true;
  render(<WalletPicker open onOpenChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Rabby" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Email" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Mobile wallets/ })).toBeDisabled();
  expect(screen.getByText(/Restoring your wallet connection/)).toBeInTheDocument();
});

it("says so when the wallet tools could not load, instead of loading forever", () => {
  walletStore.setSnapshot({ attached: false, failed: new Error("chunk failed") });
  try {
    render(<WalletPicker open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/could not load/)).toBeInTheDocument();
    expect(screen.queryByText("Loading wallets…")).toBeNull();
  } finally {
    walletStore.setSnapshot({ failed: null });
  }
});

it("shows the same rows, disabled, while the wallet island loads", () => {
  walletStore.setSnapshot({ attached: false });
  mocks.connectors = [];
  render(<WalletPicker open onOpenChange={vi.fn()} />);
  act(() => {
    globalThis.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: { info: { uuid: "1", rdns: "io.rabby", name: "Rabby", icon: "" }, provider: {} },
      }),
    );
  });
  const rows = screen.getAllByRole("button").filter((b) => b.textContent);
  expect(rows.map((b) => b.textContent)).toEqual([
    "Email",
    "Rabby",
    expect.stringMatching(/^Mobile wallets/),
  ]);
  for (const b of rows) expect(b).toBeDisabled();
  expect(screen.queryByText("Loading wallets…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Rabby" }));
  expect(mocks.connect).not.toHaveBeenCalled();
});
