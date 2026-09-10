import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainnet } from "viem/chains";
import type { EIP1193Provider } from "viem";
import { privy, privyStore } from "./privy";

const ADDR = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";

function fakeProvider(chainHex = "0x1") {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const provider = {
    request: vi.fn(({ method }: { method: string }) => {
      if (method === "eth_accounts") return Promise.resolve([ADDR.toLowerCase()]);
      if (method === "eth_chainId") return Promise.resolve(chainHex);
      if (method === "wallet_switchEthereumChain") return Promise.resolve(null);
      return Promise.reject(new Error("unexpected " + method));
    }),
    on: vi.fn((event: string, fn: (...a: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    }),
    removeListener: vi.fn((event: string, fn: (...a: unknown[]) => void) => {
      handlers.get(event)?.delete(fn);
    }),
    emit: (event: string, ...args: unknown[]) => handlers.get(event)?.forEach((fn) => fn(...args)),
    listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
  };
  return provider;
}

function makeConnector() {
  const emitter = { emit: vi.fn() };
  const connector = privy()({
    chains: [mainnet],
    emitter: emitter as never,
    providers: [],
    storage: null,
  });
  return { connector, emitter };
}

beforeEach(() => {
  privyStore.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("privyStore", () => {
  it("whenReady resolves at once unless Privy was requested", async () => {
    await expect(privyStore.whenReady(1000)).resolves.toBeUndefined();
    expect(privyStore.ready).toBe(false);
  });

  it("whenReady waits for setReady and falls back to the timeout", async () => {
    privyStore.request();
    let settled = false;
    const p = privyStore.whenReady(1000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    privyStore.setReady();
    await p;
    expect(settled).toBe(true);

    privyStore.reset();
    privyStore.request();
    const q = privyStore.whenReady(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(q).resolves.toBeUndefined();
  });

  it("waitForWallet resolves when a wallet appears and rejects on timeout", async () => {
    const provider = fakeProvider() as unknown as EIP1193Provider;
    const p = privyStore.waitForWallet(5000);
    privyStore.setWallet({ provider, address: ADDR });
    await expect(p).resolves.toMatchObject({ address: ADDR });

    privyStore.reset();
    const q = privyStore.waitForWallet(5000);
    q.catch(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    await expect(q).rejects.toThrow(/took too long/);
  });
});

describe("privy connector", () => {
  it("is not authorized until Privy is ready and has an embedded wallet", async () => {
    const { connector } = makeConnector();
    privyStore.request();
    const pending = connector.isAuthorized();
    privyStore.setReady();
    expect(await pending).toBe(false);

    privyStore.setWallet({ provider: fakeProvider() as unknown as EIP1193Provider, address: ADDR });
    expect(await connector.isAuthorized()).toBe(true);
  });

  it("connects with checksummed accounts on mainnet and switches chain on request", async () => {
    const { connector, emitter } = makeConnector();
    const provider = fakeProvider("0x5");
    privyStore.setWallet({ provider: provider as unknown as EIP1193Provider, address: ADDR });
    privyStore.setReady();
    const res = await connector.connect({ chainId: 1 });
    expect(res.accounts).toEqual([ADDR]);
    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
    expect(emitter.emit).toHaveBeenCalledWith("change", { chainId: 1 });
    expect(provider.listenerCount("accountsChanged")).toBe(1);
  });

  it("emits disconnect when Privy drops the wallet, and logs out of Privy on disconnect", async () => {
    const { connector, emitter } = makeConnector();
    const provider = fakeProvider();
    const logout = vi.fn(async () => {});
    privyStore.setLogout(logout);
    privyStore.setWallet({ provider: provider as unknown as EIP1193Provider, address: ADDR });
    privyStore.setReady();
    await connector.connect();

    privyStore.setWallet(undefined);
    expect(emitter.emit).toHaveBeenCalledWith("disconnect");
    expect(provider.listenerCount("accountsChanged")).toBe(0);

    await connector.disconnect();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("forwards provider events to wagmi", async () => {
    const { connector, emitter } = makeConnector();
    const provider = fakeProvider();
    privyStore.setWallet({ provider: provider as unknown as EIP1193Provider, address: ADDR });
    privyStore.setReady();
    await connector.connect();
    provider.emit("chainChanged", "0x1");
    expect(emitter.emit).toHaveBeenCalledWith("change", { chainId: 1 });
    provider.emit("accountsChanged", []);
    expect(emitter.emit).toHaveBeenCalledWith("disconnect");
  });
});
