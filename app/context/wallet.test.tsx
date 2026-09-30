import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { createWalletStore, walletStore } from "~/lib/wallet-store";
import { useWallet, useWalletStore, WalletStoreProvider } from "./wallet";

const ADDR = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";

afterEach(cleanup);

it("renders the store's snapshot and follows its changes", () => {
  const store = createWalletStore(() => Promise.reject(new Error("no island in this test")));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WalletStoreProvider store={store}>{children}</WalletStoreProvider>
  );
  const { result } = renderHook(() => useWallet(), { wrapper });
  expect(result.current).toMatchObject({ status: "disconnected", isConnected: false });
  act(() => store.setSnapshot({ status: "connected", address: ADDR, isConnected: true }));
  expect(result.current).toMatchObject({ status: "connected", address: ADDR, isConnected: true });
  expect(result.current.load).toBe(store.load);
  expect(result.current.connect).toBe(store.connect);
});

it("uses the app's store when no provider is rendered", () => {
  const { result } = renderHook(() => useWalletStore());
  expect(result.current).toBe(walletStore);
});
