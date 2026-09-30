import { expect, it } from "vitest";
import { PRIVY_CONNECTOR_ID, privyStore, recentConnectorIsPrivy } from "./privy-store";
import * as connector from "./privy";
import { MOCK_WALLET, WALLETCONNECT_PROJECT_ID } from "./wallet-env";

it("the connector module shares the store the app talks to", () => {
  expect(connector.privyStore).toBe(privyStore);
  expect(connector.PRIVY_CONNECTOR_ID).toBe(PRIVY_CONNECTOR_ID);
});

it("reads wagmi's own record of the last connector", () => {
  localStorage.setItem("wagmi.recentConnectorId", JSON.stringify(PRIVY_CONNECTOR_ID));
  expect(recentConnectorIsPrivy()).toBe(true);
  localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
  expect(recentConnectorIsPrivy()).toBe(false);
  localStorage.removeItem("wagmi.recentConnectorId");
});

it("exposes the wallet environment without the wallet libraries", () => {
  expect(typeof WALLETCONNECT_PROJECT_ID).toBe("string");
  expect(MOCK_WALLET === undefined || MOCK_WALLET.startsWith("0x")).toBe(true);
});
