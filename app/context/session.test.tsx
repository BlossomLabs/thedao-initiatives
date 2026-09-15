import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, startTransition } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { mainnet } from "viem/chains";
import type { EIP1193Provider } from "viem";
import { api } from "~/lib/api";
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

function setup() {
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
        provider: { request, on: vi.fn(), removeListener: vi.fn() } as unknown as EIP1193Provider,
      },
    })],
    transports: { [mainnet.id]: http() },
    storage: null,
    multiInjectedProviderDiscovery: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
  const hook = renderHook(() => useSession(), { wrapper });
  return { ...hook, config, request, signature };
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

it("disconnects after a refused signature and allows a fresh retry", async () => {
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
  expect(config.state.status).toBe("disconnected");
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
});

it.each([false, true])("handles a restored wallet (stored session: %s)", async (stored) => {
  if (stored) localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  const { result, config, request } = setup();
  await act(async () => {
    config.connectors[0].emitter.emit("connect", { accounts: [ADDRESS], chainId: 1 });
    await Promise.resolve();
  });
  expect(config.state.status).toBe(stored ? "connected" : "disconnected");
  expect(result.current.session).toEqual(stored ? SESSION : null);
  expect(request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
});
