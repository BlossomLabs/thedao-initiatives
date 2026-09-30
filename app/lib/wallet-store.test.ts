import { afterEach, expect, it, vi } from "vitest";
import {
  createWalletStore,
  hasStoredWagmiConnection,
  type WalletApi,
  type WalletIsland,
  type WalletStore,
} from "./wallet-store";

const ADDR = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A stand-in for the wallet island: attaches a fake API whose reconnect settles on demand. */
function fakeIsland() {
  const restored = deferred<void>();
  const config = { fake: true } as unknown as WalletApi["config"];
  const api: WalletApi = {
    config,
    connect: vi.fn(() => Promise.resolve({ accounts: [ADDR] as const, chainId: 1 })),
    disconnect: vi.fn(() => Promise.resolve()),
    signMessage: vi.fn(() => Promise.resolve("0xsig" as `0x${string}`)),
    switchChain: vi.fn(() => Promise.resolve(undefined)),
    getConnection: () => ({ status: "disconnected" as const }),
    createSiweMessage: () => "message",
    restored: restored.promise,
  };
  const install = vi.fn((store: WalletStore) => {
    store.attach(api);
    return api;
  });
  const island: WalletIsland = { install };
  return { api, install, restored, loader: vi.fn(() => Promise.resolve(island)) };
}

afterEach(() => localStorage.clear());

it("starts disconnected with nothing loaded", () => {
  const store = createWalletStore(fakeIsland().loader);
  expect(store.getSnapshot()).toEqual({
    status: "disconnected",
    address: undefined,
    chainId: undefined,
    connector: undefined,
    isConnected: false,
    connectors: [],
    config: undefined,
    attached: false,
    restoring: false,
    failed: null,
  });
  expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
});

it("a restoring load reports reconnecting until the island is in and its reconnect settled", async () => {
  const island = fakeIsland();
  const store = createWalletStore(island.loader);
  const loading = store.load({ restoring: true });
  expect(store.getSnapshot()).toMatchObject({ status: "reconnecting", restoring: true });
  const api = await loading;
  expect(api).toBe(island.api);
  expect(store.getSnapshot()).toMatchObject({
    attached: true,
    config: island.api.config,
    restoring: true,
  });
  island.restored.resolve();
  await island.restored.promise;
  await Promise.resolve();
  expect(store.getSnapshot().restoring).toBe(false);
});

it("a plain load keeps the disconnected state while the island downloads", async () => {
  const island = fakeIsland();
  const store = createWalletStore(island.loader);
  const loading = store.load();
  expect(store.getSnapshot()).toMatchObject({ status: "disconnected", restoring: false });
  await loading;
  expect(store.getSnapshot().attached).toBe(true);
});

it("loads the island once", async () => {
  const island = fakeIsland();
  const store = createWalletStore(island.loader);
  const [a, b] = await Promise.all([store.load(), store.load()]);
  expect(a).toBe(b);
  expect(island.loader).toHaveBeenCalledTimes(1);
  expect(island.install).toHaveBeenCalledTimes(1);
  await expect(store.whenReady()).resolves.toBe(a);
});

it("notifies subscribers of each change and stops after unsubscribe", () => {
  const store = createWalletStore(fakeIsland().loader);
  const listener = vi.fn();
  const off = store.subscribe(listener);
  store.setSnapshot({ status: "connected", address: ADDR, isConnected: true });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot()).toMatchObject({ status: "connected", address: ADDR });
  off();
  store.setSnapshot({ status: "disconnected" });
  expect(listener).toHaveBeenCalledTimes(1);
});

it("an action before the island loads it and waits for the reconnect to settle", async () => {
  const island = fakeIsland();
  const store = createWalletStore(island.loader);
  const connector = { id: "io.metamask" } as never;
  const connecting = store.connect({ connector, chainId: 1 });
  expect(island.loader).toHaveBeenCalledTimes(1);
  await store.whenReady();
  await Promise.resolve();
  expect(island.api.connect).not.toHaveBeenCalled();
  island.restored.resolve();
  await expect(connecting).resolves.toEqual({ accounts: [ADDR], chainId: 1 });
  expect(island.api.connect).toHaveBeenCalledWith({ connector, chainId: 1 });
});

it("a failed download leaves the wallet disconnected and is retried by the next load", async () => {
  const island = fakeIsland();
  const loader = vi.fn()
    .mockRejectedValueOnce(new Error("chunk failed"))
    .mockImplementation(island.loader);
  const store = createWalletStore(loader);
  await expect(store.load({ restoring: true })).rejects.toThrow("chunk failed");
  expect(store.getSnapshot()).toMatchObject({
    status: "disconnected",
    restoring: false,
    attached: false,
    failed: expect.any(Error),
  });
  await store.load();
  expect(loader).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()).toMatchObject({ attached: true, failed: null });
});

it("recognises wagmi's stored connection by its current entry", () => {
  expect(hasStoredWagmiConnection()).toBe(false);
  localStorage.setItem("wagmi.store", JSON.stringify({ state: { current: null }, version: 3 }));
  expect(hasStoredWagmiConnection()).toBe(false);
  localStorage.setItem("wagmi.store", "{not json");
  expect(hasStoredWagmiConnection()).toBe(false);
  localStorage.setItem(
    "wagmi.store",
    JSON.stringify({
      state: { connections: { __type: "Map", value: [["uid", {}]] }, chainId: 1, current: "uid" },
      version: 3,
    }),
  );
  expect(hasStoredWagmiConnection()).toBe(true);
});

it("forgetting the stored connection removes only wagmi's record", () => {
  localStorage.setItem("wagmi.store", "{}");
  localStorage.setItem("wagmi.recentConnectorId", '"injected"');
  createWalletStore(fakeIsland().loader).forgetStoredConnection();
  expect(localStorage.getItem("wagmi.store")).toBeNull();
  expect(localStorage.getItem("wagmi.recentConnectorId")).toBe('"injected"');
});

it("a directly attached island satisfies later loads without the loader", async () => {
  const island = fakeIsland();
  const store = createWalletStore(island.loader);
  store.attach(island.api);
  await expect(store.load()).resolves.toBe(island.api);
  expect(island.loader).not.toHaveBeenCalled();
});
