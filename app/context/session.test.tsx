import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, startTransition } from "react";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect as connectWallet } from "wagmi/actions";
import { mainnet } from "viem/chains";
import type { EIP1193Provider } from "viem";
import { api, ApiError } from "~/lib/api";
import { SESSION_KEY } from "~/lib/session-migration";
import { SessionProvider, useSession } from "./session";

vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

const ADDRESS = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";
const SESSION = { address: ADDRESS, isAdmin: false, expiresAt: 9_999_999_999 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(sharedProvider?: EIP1193Provider, reconnectOnMount = false) {
  const signature = deferred<`0x${string}`>();
  const request = vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
    if (method === "wallet_requestPermissions") {
      return [{ parentCapability: "eth_accounts", caveats: [{ value: [ADDRESS] }] }];
    }
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [ADDRESS];
    if (method === "eth_chainId") return "0x1";
    if (method === "personal_sign") return await signature.promise;
    if (method === "wallet_revokePermissions") return null;
    throw new Error("Unexpected wallet request: " + method);
  });
  const config = createConfig({
    chains: [mainnet],
    connectors: [injected({
      target: {
        id: "io.metamask",
        name: "MetaMask",
        provider: sharedProvider ??
          { request, on: vi.fn(), removeListener: vi.fn() } as unknown as EIP1193Provider,
      },
    })],
    transports: { [mainnet.id]: http() },
    storage: null,
    multiInjectedProviderDiscovery: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config} reconnectOnMount={reconnectOnMount}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
  const hook = renderHook(() => useSession(), { wrapper });
  return { ...hook, config, request, signature, queryClient };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation((path) => {
    if (path === "/api/auth/nonce") return Promise.resolve({ nonce: "abcdefgh12345678" });
    if (path === "/api/auth/verify") return Promise.resolve(SESSION);
    if (path === "/api/auth/me") return Promise.resolve({ ...SESSION, profile: null });
    if (path === "/api/auth/logout") return Promise.resolve({});
    throw new Error("Unexpected API request: " + path);
  });
});

afterEach(() => cleanup());

it.each([false, true])(
  "keeps the wallet connected while signing in (deferred React updates: %s)",
  async (transition) => {
    const { result, config, request, signature } = setup();
    let pending!: Promise<void>;
    let failure: unknown;
    act(() => {
      const connect = () => {
        pending = result.current.connect(config.connectors[0]);
        void pending.catch((error) => {
          failure = error;
        });
      };
      if (transition) startTransition(connect);
      else connect();
    });
    await waitFor(() => {
      expect(failure).toBeUndefined();
      expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(true);
    });
    expect(config.state.status).toBe("connected");
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_revokePermissions" }),
    );
    expect(result.current.session).toBeNull();
    await act(async () => {
      signature.resolve("0x1234");
      await pending;
    });
    expect(result.current.session).toEqual(SESSION);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(SESSION);
    expect(config.state.status).toBe("connected");
  },
);

it("shares overlapping connect requests instead of opening a second wallet prompt", async () => {
  const { result, config, request, signature } = setup();
  const permissions = deferred<unknown>();
  request.mockImplementationOnce(() => permissions.promise);
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.connect(config.connectors[0]);
    second = result.current.connect(config.connectors[0]);
    void first.catch(() => {});
    void second.catch(() => {});
  });
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(request.mock.calls.filter(([args]) => args.method === "wallet_requestPermissions"))
    .toHaveLength(1);
  expect(api).not.toHaveBeenCalledWith("/api/auth/nonce");
  await act(async () => {
    permissions.resolve([{ parentCapability: "eth_accounts", caveats: [{ value: [ADDRESS] }] }]);
    signature.resolve("0x1234");
    await Promise.all([first, second]);
  });
  expect(result.current.session).toEqual(SESSION);
  expect(request.mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(1);
});

it("shares a pending sign-in with other actions requiring a session", async () => {
  const { result, config, request, signature } = setup();
  let connecting!: Promise<void>;
  act(() => {
    connecting = result.current.connect(config.connectors[0]);
  });
  await waitFor(() => expect(result.current.signingIn).toBe(true));
  let required!: ReturnType<typeof result.current.requireSession>;
  act(() => {
    required = result.current.requireSession();
  });
  await waitFor(() =>
    expect(request.mock.calls.some(([args]) => args.method === "personal_sign"))
      .toBe(true)
  );
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/api/auth/nonce")).toHaveLength(1);
  await act(async () => {
    signature.resolve("0x1234");
    await connecting;
    expect(await required).toEqual(SESSION);
  });
});

it("does not let an overlapping prompt failure disconnect the active sign-in", async () => {
  const { result, config, request, signature } = setup();
  const permissions = deferred<unknown>();
  const nonce = deferred<{ nonce: string }>();
  const originalApi = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, options) =>
    path === "/api/auth/nonce" ? nonce.promise : originalApi(path, options)
  );
  const originalRequest = request.getMockImplementation()!;
  let prompts = 0;
  request.mockImplementation((args) => {
    if (args.method !== "wallet_requestPermissions") return originalRequest(args);
    if (++prompts === 1) return permissions.promise;
    return Promise.reject(Object.assign(new Error("Request already pending"), { code: -32002 }));
  });
  let pending!: Promise<void[]>;
  act(() => {
    pending = Promise.all([
      result.current.connect(config.connectors[0]),
      result.current.connect(config.connectors[0]),
    ]);
    void pending.catch(() => {});
  });
  await waitFor(() => expect(request).toHaveBeenCalled());
  await act(async () => {
    // Any duplicate-prompt rejection settles before the first prompt is approved.
    await Promise.resolve();
    permissions.resolve([{ parentCapability: "eth_accounts", caveats: [{ value: [ADDRESS] }] }]);
  });
  await waitFor(() => expect(result.current.signingIn).toBe(true));
  expect(config.state.status).toBe("connected");
  expect(request.mock.calls.some(([args]) => args.method === "wallet_revokePermissions"))
    .toBe(false);
  await act(async () => {
    nonce.resolve({ nonce: "abcdefgh12345678" });
    signature.resolve("0x1234");
    await pending;
  });
  expect(result.current.session).toEqual(SESSION);
});

it("keeps wallet permissions after a refused signature and retries without reconnecting", async () => {
  const { result, config, request, signature } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.connect(config.connectors[0]);
  });
  await waitFor(() =>
    expect(request.mock.calls.some(([args]) => args.method === "personal_sign"))
      .toBe(true)
  );
  await act(async () => {
    const rejected = expect(pending).rejects.toThrow(/rejected/i);
    signature.reject(Object.assign(new Error("User rejected request"), { code: 4001 }));
    await rejected;
  });
  expect(config.state.status).toBe("connected");
  expect(request.mock.calls.some(([args]) => args.method === "wallet_revokePermissions"))
    .toBe(false);
  expect(result.current.session).toBeNull();
  expect(result.current.connecting).toBe(false);
  expect(result.current.signingIn).toBe(false);
  expect(vi.mocked(api).mock.calls.some(([path]) => path === "/api/auth/verify")).toBe(false);
  const originalRequest = request.getMockImplementation()!;
  request.mockImplementation((args) =>
    args.method === "personal_sign" ? Promise.resolve("0x5678") : originalRequest(args)
  );
  await act(() => result.current.connect(config.connectors[0]));
  expect(config.state.status).toBe("connected");
  expect(result.current.session).toEqual(SESSION);
  expect(request.mock.calls.filter(([args]) => args.method === "wallet_requestPermissions"))
    .toHaveLength(1);
  expect(request.mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(2);
});

it.each([false, true])("handles a restored wallet (stored session: %s)", async (stored) => {
  if (stored) localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const { result, config, request } = setup();
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 1 });
    await Promise.resolve();
  });
  expect(config.state.status).toBe("connected");
  expect(result.current.session).toEqual(stored ? SESSION : null);
  expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
  expect(request.mock.calls.some(([args]) => args.method === "wallet_revokePermissions"))
    .toBe(false);
});

it("starts a new pairing for a restored WalletConnect connection instead of signing over it", async () => {
  // wagmi restores a WalletConnect session from storage without asking the
  // wallet, which may have dropped it: SIWE over it can hang unseen, and only
  // a new pairing gives the QR code and the mobile deep links.
  const { result, config, request, signature } = setup();
  const wc = config._internal.connectors.setup(
    injected({
      target: {
        id: "walletConnect",
        name: "WalletConnect",
        provider: { request, on: vi.fn(), removeListener: vi.fn() } as unknown as EIP1193Provider,
      },
    }),
  );
  config._internal.connectors.setState((x) => [...x, wc]);
  await act(() => connectWallet(config, { connector: wc }));
  expect(result.current.session).toBeNull();
  request.mockClear();

  let pending!: Promise<void>;
  act(() => {
    pending = result.current.connect(wc);
  });
  await waitFor(() =>
    expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(true)
  );
  const methods = request.mock.calls.map(([args]) => args.method);
  expect(methods.indexOf("wallet_revokePermissions")).toBeGreaterThanOrEqual(0);
  expect(methods.indexOf("wallet_requestPermissions"))
    .toBeGreaterThan(methods.indexOf("wallet_revokePermissions"));
  await act(async () => {
    signature.resolve("0x1234");
    await pending;
  });
  expect(result.current.session).toEqual(SESSION);
  expect(config.state.current).toBe(wc.uid);
});

/** A stand-in for wagmi's WalletConnect connector whose disconnect() fails the
 * way WalletConnect's does while the relay is unreachable: it throws before
 * deleting its stored session. */
function unreachableWalletConnect(config: ReturnType<typeof setup>["config"], request: unknown) {
  const cleanup = vi.fn(async () => {});
  const provider = { request, on: vi.fn(), removeListener: vi.fn(), signer: { cleanup } };
  const wc = config._internal.connectors.setup(
    injected({
      target: {
        id: "walletConnect",
        name: "WalletConnect",
        provider: provider as unknown as EIP1193Provider,
      },
    }),
  );
  wc.disconnect = () => Promise.reject(new Error("Failed to publish payload"));
  config._internal.connectors.setState((x) => [...x, wc]);
  return { wc, cleanup };
}

it("starts a new pairing even when the restored WalletConnect session cannot be ended", async () => {
  const { result, config, request, signature } = setup();
  const { wc, cleanup } = unreachableWalletConnect(config, request);
  await act(() => connectWallet(config, { connector: wc }));
  request.mockClear();

  let pending!: Promise<void>;
  act(() => {
    pending = result.current.connect(wc);
  });
  await waitFor(() =>
    expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(true)
  );
  expect(cleanup).toHaveBeenCalled();
  expect(request.mock.calls.some(([args]) => args.method === "wallet_requestPermissions"))
    .toBe(true);
  await act(async () => {
    signature.resolve("0x1234");
    await pending;
  });
  expect(result.current.session).toEqual(SESSION);
});

it("signs out of a WalletConnect session that cannot be ended, so a reload does not restore it", async () => {
  const { result, config, request, signature } = setup();
  const { wc, cleanup } = unreachableWalletConnect(config, request);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.connect(wc);
  });
  await waitFor(() =>
    expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(true)
  );
  await act(async () => {
    signature.resolve("0x1234");
    await pending;
  });
  cleanup.mockClear();
  await act(() => result.current.signOut());
  expect(cleanup).toHaveBeenCalled();
  expect(config.state.connections.size).toBe(0);
  expect(config.state.status).toBe("disconnected");
});

it.each([false, true])(
  "does not let another tab cancel SIWE (second tab opens during sign-in: %s)",
  async (opensDuringSignIn) => {
    // Both page instances receive the same origin's MetaMask account events.
    // Use real wagmi connectors so disconnect would actually request revocation.
    const events = new EventEmitter();
    const signature = deferred<`0x${string}`>();
    let authorized = false;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_requestPermissions") {
        authorized = true;
        events.emit("accountsChanged", [ADDRESS]);
        return [{ parentCapability: "eth_accounts", caveats: [{ value: [ADDRESS] }] }];
      }
      if (method === "eth_accounts") return authorized ? [ADDRESS] : [];
      if (method === "eth_chainId") return "0x1";
      if (method === "personal_sign") return await signature.promise;
      if (method === "wallet_revokePermissions") {
        authorized = false;
        events.emit("accountsChanged", []);
        return null;
      }
      throw new Error("Unexpected wallet request: " + method);
    });
    const provider = {
      request,
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
    } as unknown as EIP1193Provider;
    const first = setup(provider);
    let second = opensDuringSignIn ? undefined : setup(provider, true);
    if (second) await waitFor(() => expect(second!.config.state.status).toBe("disconnected"));
    let pending!: Promise<void>;
    act(() => {
      pending = first.result.current.connect(first.config.connectors[0]);
      void pending.catch(() => {});
    });
    await waitFor(() =>
      expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(true)
    );
    if (opensDuringSignIn) second = setup(provider, true);
    await waitFor(() => expect(second!.config.state.status).toBe("connected"));
    expect(second!.result.current.session).toBeNull();
    expect(first.result.current.signingIn).toBe(true);
    expect(request.mock.calls.some(([args]) => args.method === "wallet_revokePermissions"))
      .toBe(false);
    expect(request.mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(1);
    await act(async () => {
      signature.resolve("0x1234");
      await pending;
    });
    expect(first.result.current.session).toEqual(SESSION);
    expect(first.config.state.status).toBe("connected");
    expect(second!.config.state.status).toBe("connected");
  },
);

it("requires SIWE before a restored connection can use a protected action", async () => {
  const { result, config, request, signature } = setup();
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 1 });
    await Promise.resolve();
  });
  expect(result.current.session).toBeNull();
  let pending!: ReturnType<typeof result.current.requireSession>;
  act(() => {
    pending = result.current.requireSession();
  });
  await waitFor(() => expect(result.current.signingIn).toBe(true));
  expect(result.current.session).toBeNull();
  expect(vi.mocked(api).mock.calls.some(([path]) => path === "/api/auth/verify")).toBe(false);
  await act(async () => {
    signature.resolve("0x1234");
    expect(await pending).toEqual(SESSION);
  });
  expect(result.current.session).toEqual(SESSION);
  expect(request.mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(1);
});

it("clears an expired API session without revoking wallet permissions", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const originalApi = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, options) =>
    path === "/api/auth/me"
      ? Promise.reject(new ApiError(401, "session expired"))
      : originalApi(path, options)
  );
  const { result, config, request } = setup();
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 1 });
    await Promise.resolve();
  });
  await waitFor(() => expect(result.current.session).toBeNull());
  expect(config.state.status).toBe("connected");
  expect(request.mock.calls.some(([args]) => args.method === "wallet_revokePermissions"))
    .toBe(false);
  expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
});

it("clears the old session on account changes without prompting or revoking permissions", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const { result, config, request } = setup();
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 1 });
    await Promise.resolve();
  });
  await act(async () => {
    config.connectors[0].emitter.emit("change", {
      accounts: ["0x1111111111111111111111111111111111111111"],
    });
    await Promise.resolve();
  });
  expect(result.current.session).toBeNull();
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  expect(api).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  expect(config.state.status).toBe("connected");
  expect(request.mock.calls.some(([args]) => args.method === "wallet_revokePermissions"))
    .toBe(false);
  expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
});

it("still revokes wallet permissions and the API session on explicit sign-out", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const { result, config, request } = setup();
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 1 });
    await Promise.resolve();
  });
  await act(() => result.current.signOut());
  expect(result.current.session).toBeNull();
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  expect(config.state.status).toBe("disconnected");
  expect(api).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  expect(request).toHaveBeenCalledWith({
    method: "wallet_revokePermissions",
    params: [{ eth_accounts: {} }],
  });
});

it("signs out of every connected wallet, so an earlier one does not take over", async () => {
  // Rabby restored without a session, then MetaMask picked in the chooser:
  // wagmi keeps both, and disconnecting only MetaMask would make Rabby current.
  const OTHER = "0x0000000000000000000000000000000000000abc";
  const wallet = (account: string) => {
    const signature = deferred<`0x${string}`>();
    const request = vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
      if (method === "wallet_requestPermissions") {
        return [{ parentCapability: "eth_accounts", caveats: [{ value: [account] }] }];
      }
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0x1";
      if (method === "personal_sign") return await signature.promise;
      if (method === "wallet_revokePermissions") return null;
      throw new Error("Unexpected wallet request: " + method);
    });
    const provider = { request, on: vi.fn(), removeListener: vi.fn() };
    return { request, signature, provider: provider as unknown as EIP1193Provider };
  };
  const rabby = wallet(OTHER);
  const metamask = wallet(ADDRESS);
  const config = createConfig({
    chains: [mainnet],
    connectors: [
      injected({ target: { id: "io.rabby", name: "Rabby", provider: rabby.provider } }),
      injected({ target: { id: "io.metamask", name: "MetaMask", provider: metamask.provider } }),
    ],
    transports: { [mainnet.id]: http() },
    storage: null,
    multiInjectedProviderDiscovery: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useSession(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <WagmiProvider config={config} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>{children}</SessionProvider>
        </QueryClientProvider>
      </WagmiProvider>
    ),
  });
  await act(() => connectWallet(config, { connector: config.connectors[0] }));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.connect(config.connectors[1]);
  });
  await waitFor(() =>
    expect(metamask.request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(
      true,
    )
  );
  await act(async () => {
    metamask.signature.resolve("0x1234");
    await pending;
  });
  expect(result.current.session).toEqual(SESSION);
  expect(config.state.connections.size).toBe(2);
  await act(() => result.current.signOut());
  expect(config.state.status).toBe("disconnected");
  expect(config.state.connections.size).toBe(0);
  expect(result.current.address).toBeUndefined();
});

it("drops an unanswered connection for another method, and disconnects it if approved later", async () => {
  // WalletConnect cannot abort a pairing: a QR scanned after the user moved on
  // to another wallet must not take over.
  const OTHER = "0x0000000000000000000000000000000000000abc";
  const approval = deferred<void>();
  const late = vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
    if (method === "wallet_requestPermissions") {
      await approval.promise;
      return [{ parentCapability: "eth_accounts", caveats: [{ value: [OTHER] }] }];
    }
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [OTHER];
    if (method === "eth_chainId") return "0x1";
    if (method === "wallet_revokePermissions") return null;
    throw new Error("Unexpected wallet request: " + method);
  });
  const { result, config, signature } = setup();
  const qr = injected({
    target: {
      id: "qr",
      name: "QR",
      provider: {
        request: late,
        on: vi.fn(),
        removeListener: vi.fn(),
      } as unknown as EIP1193Provider,
    },
  });
  const pairingConnector = config._internal.connectors.setup(qr);
  config._internal.connectors.setState((x) => [...x, pairingConnector]);
  let pairing!: Promise<void>;
  act(() => {
    pairing = result.current.connect(pairingConnector);
  });
  await waitFor(() => expect(late).toHaveBeenCalled());
  const dropped = pairing.catch((error) => error);
  act(() => {
    expect(result.current.cancelPairing()).toBe(true);
  });
  expect(await dropped).toHaveProperty("message", "Connection cancelled.");
  expect(result.current.connecting).toBe(false);

  let pending!: Promise<void>;
  act(() => {
    pending = result.current.connect(config.connectors[0]);
  });
  await waitFor(() => expect(result.current.signingIn).toBe(true));
  expect(result.current.cancelPairing()).toBe(false);
  await act(async () => {
    signature.resolve("0x1234");
    await pending;
  });
  expect(result.current.session).toEqual(SESSION);

  await act(async () => {
    approval.resolve();
    await waitFor(() =>
      expect(late.mock.calls.some(([args]) => args.method === "wallet_revokePermissions")).toBe(
        true,
      )
    );
  });
  expect([...config.state.connections.values()].map((c) => c.connector.uid)).toEqual([
    config.connectors[0].uid,
  ]);
  expect(result.current.session).toEqual(SESSION);
});

/** A wallet whose site chain is not Ethereum (Ambire keeps one per site and
 * refuses personal_sign when it is not an enabled network; MetaMask signs
 * anyway, but a smart account's signature only verifies on the chain it was
 * made for). */
function walletOnChain(hex: string) {
  let chain = hex;
  const signature = deferred<`0x${string}`>();
  const request = vi.fn(
    async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        chain = (params![0] as { chainId: string }).chainId;
        return null;
      }
      if (method === "personal_sign") return await signature.promise;
      throw new Error("Unexpected wallet request: " + method);
    },
  );
  const provider = { request, on: vi.fn(), removeListener: vi.fn() } as unknown as EIP1193Provider;
  return { provider, request, signature };
}

it("switches the wallet to Ethereum before asking for the SIWE signature", async () => {
  const { provider, request, signature } = walletOnChain("0xa");
  const { result, config } = setup(provider);
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 10 });
    await Promise.resolve();
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.signIn(ADDRESS);
    void pending.catch(() => {});
  });
  await waitFor(() =>
    expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(true)
  );
  const methods = request.mock.calls.map(([args]) => args.method);
  expect(methods.indexOf("wallet_switchEthereumChain")).toBeGreaterThanOrEqual(0);
  expect(methods.indexOf("wallet_switchEthereumChain")).toBeLessThan(
    methods.indexOf("personal_sign"),
  );
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    }),
  );
  await act(async () => {
    signature.resolve("0x1234");
    await pending;
  });
  expect(result.current.session).toEqual(SESSION);
  expect(config.state.connections.get(config.state.current!)!.chainId).toBe(1);
});

it("a refused chain switch ends the sign-in without a signature request", async () => {
  const { provider, request } = walletOnChain("0xa");
  const { result, config } = setup(provider);
  request.mockImplementation(({ method }) => {
    if (method === "eth_accounts") return Promise.resolve([ADDRESS]);
    if (method === "eth_chainId") return Promise.resolve("0xa");
    if (method === "wallet_switchEthereumChain") {
      return Promise.reject(
        Object.assign(new Error("User rejected the request."), { code: 4001 }),
      );
    }
    return Promise.reject(new Error("Unexpected wallet request: " + method));
  });
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 10 });
    await Promise.resolve();
  });
  await act(async () => {
    await expect(result.current.signIn(ADDRESS)).rejects.toThrow(/rejected/i);
  });
  expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
  expect(result.current.session).toBeNull();
  expect(result.current.signingIn).toBe(false);
});

it("deletes only the chosen wallet's draft and clears private cache even when logout is offline", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const { result, queryClient } = setup();
  await waitFor(() => expect(result.current.me).not.toBeNull());
  queryClient.setQueryData(["admin", "leads"], { secret: "private leads" });
  localStorage.setItem("thedao:submit-draft", "legacy private draft");
  localStorage.setItem("thedao:submit-draft:other-wallet", "other wallet's draft");
  const late = deferred<string>();
  const fetching = queryClient.fetchQuery({
    queryKey: ["revision", "private", 1],
    queryFn: () => late.promise,
  });
  void fetching.catch(() => {});
  const logout = deferred<unknown>();
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, opts) =>
    path === "/api/auth/logout" ? logout.promise : original(path, opts)
  );
  let ending!: Promise<boolean>;
  act(() => {
    ending = result.current.signOut();
  });
  expect(result.current.session).not.toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Delete draft and log out" }));
  await waitFor(() => expect(result.current.session).toBeNull());
  expect(result.current.session).toBeNull();
  expect(queryClient.getQueryData(["admin", "leads"])).toBeUndefined();
  expect(localStorage.getItem("thedao:submit-draft")).toBeNull();
  expect(localStorage.getItem(`thedao:submit-draft:${ADDRESS.toLowerCase()}`)).toBeNull();
  expect(localStorage.getItem("thedao:submit-draft:other-wallet")).toBe("other wallet's draft");
  await act(async () => {
    late.resolve("private revision");
    logout.reject(new Error("offline"));
    await ending;
  });
  expect(queryClient.getQueryData(["revision", "private", 1])).toBeUndefined();
});

it("purges private state on privilege removal and ignores an identity response arriving after logout", async () => {
  const admin = { ...SESSION, isAdmin: true };
  localStorage.setItem(SESSION_KEY, JSON.stringify(admin));
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, opts) =>
    path === "/api/auth/me" ? Promise.resolve({ ...admin }) : original(path, opts)
  );
  const { result, queryClient } = setup();
  await waitFor(() => expect(result.current.me?.isAdmin).toBe(true));
  queryClient.setQueryData(["admin", "leads"], "secret");
  vi.mocked(api).mockImplementation((path, opts) =>
    path === "/api/auth/me" ? Promise.resolve({ ...SESSION }) : original(path, opts)
  );
  act(() => {
    globalThis.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(result.current.session?.isAdmin).toBe(false));
  expect(api).toHaveBeenCalledWith("/api/auth/me", { passive: true });
  expect(queryClient.getQueryData(["admin", "leads"])).toBeUndefined();
  const late = deferred<unknown>();
  vi.mocked(api).mockImplementation((path, opts) =>
    path === "/api/auth/me" ? late.promise : original(path, opts)
  );
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = result.current.refreshMe();
  });
  await act(() => result.current.signOut());
  await act(async () => {
    late.resolve(admin);
    await refreshing;
  });
  expect(result.current.me).toBeNull();
  expect(result.current.session).toBeNull();
});

it("preserves the signed-in wallet's draft through reload validation, reauthentication and privilege changes", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const draft = JSON.stringify({ priv: { contact: "my private draft" } });
  localStorage.setItem("thedao:submit-draft", draft);
  const { result, signature, config } = setup();
  act(() => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 1 });
  });
  const key = `thedao:submit-draft:${ADDRESS.toLowerCase()}`;
  await waitFor(() => expect(result.current.me).not.toBeNull());
  expect(localStorage.getItem(key)).toBe(draft);
  expect(localStorage.getItem("thedao:submit-draft")).toBeNull();
  let signing!: Promise<unknown>;
  act(() => {
    signing = result.current.signIn(ADDRESS);
  });
  await act(async () => {
    signature.resolve("0x1234");
    await signing;
  });
  expect(localStorage.getItem(key)).toBe(draft);
  vi.mocked(api).mockResolvedValue({ ...SESSION, isAdmin: true });
  await act(() => result.current.refreshMe());
  expect(localStorage.getItem(key)).toBe(draft);
});

it("retains the owner's draft across automatic session expiry and a reload for reauthentication", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const key = `thedao:submit-draft:${ADDRESS.toLowerCase()}`;
  const draft = JSON.stringify({ priv: { contact: "unfinished private draft" } });
  localStorage.setItem(key, draft);
  const first = setup();
  await waitFor(() => expect(first.result.current.me).not.toBeNull());
  first.queryClient.setQueryData(["admin", "leads"], "private cached server data");
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, opts) =>
    path === "/api/auth/me"
      ? Promise.reject(new ApiError(401, "Session expired"))
      : original(path, opts)
  );
  await act(() => first.result.current.refreshMe());
  expect(first.result.current.session).toBeNull();
  expect(first.queryClient.getQueryData(["admin", "leads"])).toBeUndefined();
  expect(localStorage.getItem(key)).toBe(draft);
  first.unmount();
  vi.mocked(api).mockImplementation(original);
  const second = setup();
  expect(second.result.current.session).toBeNull();
  expect(localStorage.getItem(key)).toBe(draft);
  let connecting!: Promise<void>;
  act(() => {
    connecting = second.result.current.connect(second.config.connectors[0]);
  });
  await waitFor(() => expect(second.result.current.signingIn).toBe(true));
  await act(async () => {
    second.signature.resolve("0x1234");
    await connecting;
  });
  expect(second.result.current.session?.address).toBe(ADDRESS);
  expect(localStorage.getItem(key)).toBe(draft);
  let ending!: Promise<boolean>;
  act(() => {
    ending = second.result.current.signOut();
  });
  fireEvent.click(await screen.findByRole("button", { name: "Keep draft and log out" }));
  await act(async () => {
    await ending;
  });
  expect(second.result.current.session).toBeNull();
  expect(localStorage.getItem(key)).toBe(draft);
});

it("cancelling the draft popup leaves the session, draft and revocation action untouched", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const key = `thedao:submit-draft:${ADDRESS.toLowerCase()}`;
  localStorage.setItem(key, "unfinished draft");
  const { result } = setup();
  await waitFor(() => expect(result.current.me).not.toBeNull());
  const beforeLogout = vi.fn();
  let ending!: Promise<boolean>;
  act(() => {
    ending = result.current.signOut(beforeLogout);
  });
  fireEvent.click(await screen.findByRole("button", { name: /^Cancel$/ }));
  await act(async () => {
    expect(await ending).toBe(false);
  });
  expect(result.current.session).toEqual(SESSION);
  expect(localStorage.getItem(key)).toBe("unfinished draft");
  expect(beforeLogout).not.toHaveBeenCalled();
  expect(api).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
});

it("switching wallets retains every draft without showing a deletion popup", async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const key = `thedao:submit-draft:${ADDRESS.toLowerCase()}`;
  localStorage.setItem(key, "wallet A draft");
  localStorage.setItem("thedao:submit-draft:wallet-b", "wallet B draft");
  const { result, queryClient } = setup();
  await waitFor(() => expect(result.current.me).not.toBeNull());
  queryClient.setQueryData(["admin", "leads"], "private server data");
  await act(() => result.current.switchWallet());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(result.current.session).toBeNull();
  expect(queryClient.getQueryData(["admin", "leads"])).toBeUndefined();
  expect(localStorage.getItem(key)).toBe("wallet A draft");
  expect(localStorage.getItem("thedao:submit-draft:wallet-b")).toBe("wallet B draft");
});

/** A wallet prompt left open for a while: the signed message is older than the
 * server's window. The client fetches a fresh nonce and asks for one more signature. */
it("retries once with a fresh nonce when the signed message aged out of the server window", async () => {
  const { result, config, request } = setup();
  const originalRequest = request.getMockImplementation()!;
  request.mockImplementation((args) =>
    args.method === "personal_sign" ? Promise.resolve("0x1234") : originalRequest(args)
  );
  const originalApi = vi.mocked(api).getMockImplementation()!;
  let nonces = 0;
  let verifies = 0;
  vi.mocked(api).mockImplementation((path, options) => {
    if (path === "/api/auth/nonce") return Promise.resolve({ nonce: `abcdefgh1234567${++nonces}` });
    if (path === "/api/auth/verify" && ++verifies === 1) {
      return Promise.reject(new ApiError(401, "issuedAt out of window"));
    }
    return originalApi(path, options);
  });
  await act(() => result.current.connect(config.connectors[0]));
  expect(nonces).toBe(2);
  expect(request.mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(2);
  const verifyBodies = vi.mocked(api).mock.calls
    .filter(([path]) => path === "/api/auth/verify")
    .map(([, options]) => (options!.json as { message: string }).message);
  expect(verifyBodies[0]).toContain("abcdefgh12345671");
  expect(verifyBodies[1]).toContain("abcdefgh12345672");
  expect(result.current.session).toEqual(SESSION);
  expect(result.current.signingIn).toBe(false);
});

it("gives up after one retry when the message is still out of the server window", async () => {
  const { result, config, request } = setup();
  const originalRequest = request.getMockImplementation()!;
  request.mockImplementation((args) =>
    args.method === "personal_sign" ? Promise.resolve("0x1234") : originalRequest(args)
  );
  const originalApi = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation((path, options) =>
    path === "/api/auth/verify"
      ? Promise.reject(new ApiError(401, "issuedAt out of window"))
      : originalApi(path, options)
  );
  await act(async () => {
    await expect(result.current.connect(config.connectors[0])).rejects.toThrow(/out of window/);
  });
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/api/auth/verify")).toHaveLength(2);
  expect(request.mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(2);
  expect(result.current.session).toBeNull();
  expect(result.current.signingIn).toBe(false);
});
