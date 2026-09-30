/** The wallet store for components: `useWallet()` renders its snapshot and
 * exposes its actions; the provider exists for tests, the app uses the
 * singleton. No element wraps the tree, so nothing remounts when the island
 * arrives. */
import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from "react";
import { type WalletSnapshot, type WalletStore, walletStore } from "~/lib/wallet-store";

const WalletStoreContext = createContext<WalletStore>(walletStore);

export function WalletStoreProvider(
  { store, children }: { store: WalletStore; children: ReactNode },
) {
  return <WalletStoreContext.Provider value={store}>{children}</WalletStoreContext.Provider>;
}

export const useWalletStore = (): WalletStore => useContext(WalletStoreContext);

export type Wallet =
  & WalletSnapshot
  & Pick<
    WalletStore,
    "load" | "connect" | "disconnect" | "signMessage" | "switchChain"
  >;

export function useWallet(): Wallet {
  const store = useWalletStore();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return useMemo(() => ({
    ...snapshot,
    load: store.load,
    connect: store.connect,
    disconnect: store.disconnect,
    signMessage: store.signMessage,
    switchChain: store.switchChain,
  }), [snapshot, store]);
}
