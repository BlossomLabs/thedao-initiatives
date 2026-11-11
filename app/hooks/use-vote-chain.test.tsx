import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createWalletStore } from "~/lib/wallet-store";
import { WalletStoreProvider } from "~/context/wallet";
import { useEnsureVoteChain, WrongChainError } from "./use-vote-chain";

afterEach(cleanup);

function setup(
  chainId: number | undefined,
  switchChain = vi.fn(() => Promise.resolve()),
  round: 1 | 11155111 = 11155111,
) {
  const store = createWalletStore(() => Promise.reject(new Error("no island")));
  store.setSnapshot({ status: "connected", isConnected: true, chainId });
  store.switchChain = switchChain;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WalletStoreProvider store={store}>{children}</WalletStoreProvider>
  );
  const { result } = renderHook(() => useEnsureVoteChain(round), { wrapper });
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

it("the real round stays on Ethereum: a mainnet wallet is left alone", async () => {
  const { ensure, switchChain } = setup(1, undefined, 1);
  await ensure();
  expect(switchChain).not.toHaveBeenCalled();
});

it("the real round asks a Sepolia wallet to switch to Ethereum", async () => {
  const { ensure } = setup(11155111, vi.fn(() => Promise.reject(new Error("no"))), 1);
  await expect(ensure()).rejects.toThrow("Switch your wallet to Ethereum to continue.");
});
