import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createWalletStore } from "~/lib/wallet-store";
import { WalletStoreProvider } from "~/context/wallet";
import { useEnsureSepolia, WrongChainError } from "./use-sepolia";

afterEach(cleanup);

function setup(chainId: number | undefined, switchChain = vi.fn(() => Promise.resolve())) {
  const store = createWalletStore(() => Promise.reject(new Error("no island")));
  store.setSnapshot({ status: "connected", isConnected: true, chainId });
  store.switchChain = switchChain;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WalletStoreProvider store={store}>{children}</WalletStoreProvider>
  );
  const { result } = renderHook(() => useEnsureSepolia(), { wrapper });
  return { ensure: result.current, switchChain };
}

it("switches a mainnet wallet to Sepolia", async () => {
  const { ensure, switchChain } = setup(1);
  await ensure();
  expect(switchChain).toHaveBeenCalledWith(expect.objectContaining({ chainId: 11155111 }));
});

it("leaves a wallet already on Sepolia alone", async () => {
  const { ensure, switchChain } = setup(11155111);
  await ensure();
  expect(switchChain).not.toHaveBeenCalled();
});

it("a refused switch is a WrongChainError", async () => {
  const { ensure } = setup(1, vi.fn(() => Promise.reject(new Error("user rejected"))));
  await expect(ensure()).rejects.toBeInstanceOf(WrongChainError);
});
