import { afterEach, expect, it, vi } from "vitest";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect, disconnect } from "wagmi/actions";
import { mainnet } from "viem/chains";
import type { EIP1193Provider } from "viem";
import { attach, install } from "./wallet-island";
import { createWalletStore } from "./wallet-store";

const ADDR = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";

// The app's own config, as `install` loads it: an authorised fake wallet.
vi.mock("./wagmi", async () => {
  const { createConfig, http } = await import("wagmi");
  const { injected } = await import("wagmi/connectors");
  const { mainnet } = await import("viem/chains");
  const request = ({ method }: { method: string }): Promise<unknown> =>
    method === "eth_accounts" || method === "eth_requestAccounts"
      ? Promise.resolve(["0x839395e20bbB182fa440d08F850E6c7A8f6F0780"])
      : method === "eth_chainId"
      ? Promise.resolve("0x1")
      : Promise.reject(new Error("Unexpected wallet request: " + method));
  const provider = {
    request,
    on: () => {},
    removeListener: () => {},
  } as unknown as EIP1193Provider;
  return {
    wagmiConfig: createConfig({
      chains: [mainnet],
      connectors: [injected({ target: { id: "io.metamask", name: "MetaMask", provider } })],
      transports: { [mainnet.id]: http() },
      storage: null,
      multiInjectedProviderDiscovery: false,
    }),
  };
});

afterEach(() => localStorage.clear());

function setup(accounts: string[] = [ADDR]) {
  const request = vi.fn(({ method }: { method: string }): Promise<unknown> => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") {
      return Promise.resolve(accounts);
    }
    if (method === "eth_chainId") return Promise.resolve("0x1");
    if (method === "wallet_requestPermissions") {
      return Promise.resolve([{ parentCapability: "eth_accounts", caveats: [{ value: [ADDR] }] }]);
    }
    return Promise.reject(new Error("Unexpected wallet request: " + method));
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
  const store = createWalletStore(() => Promise.reject(new Error("the test attaches directly")));
  return { config, store };
}

it("mirrors wagmi's connection and connectors into the store", async () => {
  const { config, store } = setup();
  const api = attach(store, config, { reconnect: false });
  expect(store.getSnapshot()).toMatchObject({
    attached: true,
    status: "disconnected",
    config,
    restoring: false,
  });
  expect(store.getSnapshot().connectors.map((c) => c.id)).toEqual(["io.metamask"]);
  await api.restored;
  await connect(config, { connector: config.connectors[0] });
  expect(store.getSnapshot()).toMatchObject({
    status: "connected",
    address: ADDR,
    chainId: 1,
    isConnected: true,
  });
  expect(store.getSnapshot().connector?.id).toBe("io.metamask");
  await disconnect(config);
  expect(store.getSnapshot()).toMatchObject({ status: "disconnected", address: undefined });
});

it("restores an authorised wallet and reports when that settled", async () => {
  const { config, store } = setup();
  const api = attach(store, config, { reconnect: true });
  expect(store.getSnapshot()).toMatchObject({ status: "reconnecting", restoring: true });
  await api.restored;
  expect(store.getSnapshot()).toMatchObject({
    status: "connected",
    address: ADDR,
    restoring: false,
  });
});

it("builds the sign-in message and answers the connection", () => {
  const { config, store } = setup();
  const api = attach(store, config, { reconnect: false });
  expect(api.getConnection().status).toBe("disconnected");
  const message = api.createSiweMessage({
    address: ADDR,
    chainId: 1,
    domain: "initiatives.thedao.fund",
    nonce: "abcdefgh12345678",
    uri: "https://initiatives.thedao.fund",
    version: "1",
  });
  expect(message).toContain("initiatives.thedao.fund wants you to sign in");
});

it("a restore that finds no authorised wallet ends disconnected and settled", async () => {
  const { config, store } = setup([]);
  const api = attach(store, config, { reconnect: true });
  expect(store.getSnapshot()).toMatchObject({ status: "reconnecting", restoring: true });
  await api.restored;
  expect(store.getSnapshot()).toMatchObject({
    status: "disconnected",
    address: undefined,
    isConnected: false,
    restoring: false,
  });
});

it("the app's island restores a wallet only when wagmi stored a connection", async () => {
  const fresh = createWalletStore(() => Promise.reject(new Error("unused")));
  const first = await install(fresh);
  expect(fresh.getSnapshot()).toMatchObject({
    attached: true,
    status: "disconnected",
    restoring: false,
  });
  await first.restored;
  expect(fresh.getSnapshot().status).toBe("disconnected");

  localStorage.setItem("wagmi.store", JSON.stringify({ state: { current: "uid" }, version: 3 }));
  const returning = createWalletStore(() => Promise.reject(new Error("unused")));
  const second = await install(returning);
  expect(returning.getSnapshot().restoring).toBe(true);
  await second.restored;
  expect(returning.getSnapshot()).toMatchObject({
    status: "connected",
    address: ADDR,
    restoring: false,
  });
});
