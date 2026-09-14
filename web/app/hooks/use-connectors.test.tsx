import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Connector } from "wagmi";

let list: Partial<Connector>[] = [];
vi.mock("wagmi", () => ({ useConnect: () => ({ connectors: list }) }));
vi.mock("~/lib/wagmi", () => ({ MOCK_WALLET: undefined }));

import { useConnectors } from "./use-connectors";

const c = (id: string, type: string, name = id): Partial<Connector> => ({
  id,
  type,
  name,
  uid: id,
});
const ids = () => renderHook(() => useConnectors()).result.current.map((x) => x.id);

describe("useConnectors", () => {
  it("phone browser: no injected wallet, so Injected stays and the MetaMask deep link is offered", () => {
    list = [c("injected", "injected", "Injected"), c("metaMaskSDK", "metaMask", "MetaMask")];
    expect(ids()).toEqual(["injected", "metaMaskSDK"]);
  });

  it("desktop with the MetaMask extension: the named wallet only, no generic Injected, no SDK copy", () => {
    list = [
      c("injected", "injected", "Injected"),
      c("io.metamask", "injected", "MetaMask"),
      c("metaMaskSDK", "metaMask", "MetaMask"),
    ];
    expect(ids()).toEqual(["io.metamask"]);
  });

  it("another extension announced: Injected hidden, MetaMask deep link still offered", () => {
    list = [
      c("injected", "injected", "Injected"),
      c("com.brave.wallet", "injected", "Brave Wallet"),
      c("metaMaskSDK", "metaMask", "MetaMask"),
    ];
    expect(ids()).toEqual(["com.brave.wallet", "metaMaskSDK"]);
  });

  it("the dev mock is dropped unless configured", () => {
    list = [c("mock", "mock", "Mock"), c("injected", "injected", "Injected")];
    expect(ids()).toEqual(["injected"]);
  });
});
