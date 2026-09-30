/**
 * The wallet as the page sees it, without the wallet libraries. wagmi, viem
 * and the connectors (~550 KB raw) live in the "wallet island"
 * (wallet-island.ts), a chunk loaded on demand or, for a returning wallet
 * user, right after the page mounts. Until then the page renders as
 * disconnected, which is what the prerendered HTML shows anyway. Components
 * read this store through `useWallet()` (context/wallet.tsx); the island
 * mirrors wagmi's connection into it and hands over the actions.
 *
 * Only types come from wagmi here; they are erased at build time.
 */
import type { Config, Connector } from "wagmi";
import type { createSiweMessage } from "viem/siwe";

export type WalletStatus = "disconnected" | "connecting" | "reconnecting" | "connected";

export interface WalletSnapshot {
  status: WalletStatus;
  address: `0x${string}` | undefined;
  chainId: number | undefined;
  connector: Connector | undefined;
  isConnected: boolean;
  /** Empty until the island is attached. */
  connectors: readonly Connector[];
  /** The wagmi config once the island is attached, for `wagmi/actions` callers. */
  config: Config | undefined;
  attached: boolean;
  /** A restore is in flight: the island's download or its reconnect. */
  restoring: boolean;
  /** The island's chunk failed to load; a later `load()` tries again. */
  failed: Error | null;
}

export interface ConnectResult {
  accounts: readonly `0x${string}`[];
  chainId: number;
}

/** What the island hands over once wagmi is up. */
export interface WalletApi {
  config: Config;
  connect(p: { connector: Connector; chainId?: number }): Promise<ConnectResult>;
  disconnect(p?: { connector?: Connector }): Promise<void>;
  signMessage(
    p: { message: string; account?: `0x${string}`; connector?: Connector },
  ): Promise<`0x${string}`>;
  switchChain(p: { chainId: number; connector?: Connector }): Promise<unknown>;
  getConnection(): { chainId?: number; address?: `0x${string}`; status: WalletStatus };
  createSiweMessage: typeof createSiweMessage;
  /** The initial reconnect has settled (at once when none ran). */
  restored: Promise<void>;
}

export interface WalletIsland {
  install(store: WalletStore): WalletApi | Promise<WalletApi>;
}

export interface WalletStore {
  getSnapshot(): WalletSnapshot;
  getServerSnapshot(): WalletSnapshot;
  subscribe(listener: () => void): () => void;
  /** Download and attach the island (once); `restoring` shows a restore as in flight meanwhile. */
  load(opts?: { restoring?: boolean }): Promise<WalletApi>;
  /** The API once attached; never starts the download. */
  whenReady(): Promise<WalletApi>;
  attach(api: WalletApi): void;
  setSnapshot(patch: Partial<WalletSnapshot>): void;
  connect: WalletApi["connect"];
  disconnect: WalletApi["disconnect"];
  signMessage: WalletApi["signMessage"];
  switchChain: WalletApi["switchChain"];
  /** Drop wagmi's stored connection (sign-out before the island ever loaded). */
  forgetStoredConnection(): void;
}

const WAGMI_STORE_KEY = "wagmi.store";

const INITIAL: WalletSnapshot = Object.freeze({
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

/** True when wagmi persisted a current connection, so a visit should restore it. */
export function hasStoredWagmiConnection(): boolean {
  try {
    const raw = localStorage.getItem(WAGMI_STORE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { current?: unknown } } | null;
    return typeof parsed?.state?.current === "string";
  } catch {
    return false;
  }
}

export function createWalletStore(
  loader: () => Promise<WalletIsland> = () => import("./wallet-island"),
): WalletStore {
  let snapshot = INITIAL;
  const listeners = new Set<() => void>();
  let pending: Promise<WalletApi> | null = null;
  let resolveReady: (api: WalletApi) => void = () => {};
  const ready = new Promise<WalletApi>((r) => {
    resolveReady = r;
  });

  const setSnapshot = (patch: Partial<WalletSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };

  const load = (opts: { restoring?: boolean } = {}) => {
    if (opts.restoring && !snapshot.attached && !snapshot.restoring) {
      setSnapshot({ status: "reconnecting", restoring: true });
    }
    return pending ??= loader().then((island) => island.install(store), (e: unknown) => {
      pending = null;
      setSnapshot({
        status: "disconnected",
        restoring: false,
        failed: e instanceof Error ? e : new Error(String(e)),
      });
      throw e;
    });
  };

  /** Actions wait for the island and for its reconnect, so a click never races a restore. */
  const settled = async () => {
    const a = await load();
    await a.restored.catch(() => {});
    return a;
  };

  const store: WalletStore = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    whenReady: () => ready,
    attach(next) {
      setSnapshot({ attached: true, config: next.config, failed: null });
      next.restored.catch(() => {}).then(() => setSnapshot({ restoring: false }));
      resolveReady(next);
    },
    setSnapshot,
    connect: (p) => settled().then((a) => a.connect(p)),
    disconnect: (p) => settled().then((a) => a.disconnect(p)),
    signMessage: (p) => settled().then((a) => a.signMessage(p)),
    switchChain: (p) => settled().then((a) => a.switchChain(p)),
    forgetStoredConnection() {
      try {
        localStorage.removeItem(WAGMI_STORE_KEY);
      } catch { /* storage unavailable */ }
    },
  };
  return store;
}

export const walletStore = createWalletStore();
