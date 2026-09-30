/**
 * The wallet island: the one module that loads wagmi and viem at runtime.
 * `install` builds the app's wagmi config, mirrors its connection into the
 * wallet store and restores a stored connection; the store's actions call
 * back into wagmi's actions with that config. Loaded by `walletStore.load()`.
 */
import type { Config } from "wagmi";
import {
  connect,
  disconnect,
  getConnection,
  getConnectors,
  reconnect,
  signMessage,
  switchChain,
  watchConnection,
  watchConnectors,
} from "wagmi/actions";
import { createSiweMessage } from "viem/siwe";
import type { WalletApi, WalletStore } from "./wallet-store";

export function attach(
  store: WalletStore,
  config: Config,
  opts: { reconnect: boolean },
): WalletApi {
  const push = () => {
    const c = getConnection(config);
    // While a restore is in flight the page keeps seeing "reconnecting"
    // (wagmi says "connecting" when nothing was stored) until it settles.
    const restoring = store.getSnapshot().restoring;
    store.setSnapshot({
      status: restoring && c.status !== "connected" ? "reconnecting" : c.status,
      address: c.address,
      chainId: c.chainId,
      connector: c.connector,
      isConnected: c.isConnected,
      connectors: getConnectors(config),
    });
  };
  // The island lives as long as the page; the watchers are never released.
  watchConnection(config, { onChange: push });
  watchConnectors(config, { onChange: push });
  if (opts.reconnect) store.setSnapshot({ status: "reconnecting", restoring: true });
  const restored = opts.reconnect
    ? reconnect(config).then(() => {}, () => {}).then(() => {
      store.setSnapshot({ restoring: false });
      push();
    })
    : Promise.resolve();
  const api: WalletApi = {
    config,
    connect: (p) => connect(config, p),
    disconnect: (p) => disconnect(config, p),
    signMessage: (p) => signMessage(config, p),
    switchChain: (p) => switchChain(config, p),
    getConnection: () => getConnection(config),
    createSiweMessage,
    restored,
  };
  store.attach(api);
  push();
  return api;
}

/** The store's loader entry: the app's config, restoring any stored connection. */
export async function install(store: WalletStore): Promise<WalletApi> {
  const { wagmiConfig } = await import("./wagmi");
  return attach(store, wagmiConfig, { reconnect: true });
}
