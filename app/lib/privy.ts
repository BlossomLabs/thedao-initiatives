/**
 * Email sign-in via a Privy embedded wallet, exposed to the rest of the app
 * as one more wagmi connector ("Email"). Privy is React-only, so a bridge
 * component (context/privy.tsx) pushes the embedded wallet's EIP-1193
 * provider into the store below and the connector reads it from there.
 *
 * The embedded wallet is a plain EOA: it signs SIWE with personal_sign like
 * any browser wallet, so the API is untouched. Privy's own wallet UIs are
 * off; the site's buttons are the confirmation step.
 *
 * Privy's SDK is heavy (~450 KB gzipped), so it is only loaded once someone
 * picks "Email" or comes back with an email session (`request()`); until
 * then the connector reports no provider and wagmi's reconnect moves on.
 */
import {
  ChainNotConfiguredError,
  createConnector,
  type CreateConnectorFn,
  ProviderNotFoundError,
} from "wagmi";
import { type EIP1193Provider, getAddress, numberToHex } from "viem";
import { PRIVY_CONNECTOR_ID, privyStore } from "./privy-store";

export {
  PRIVY_APP_ID,
  PRIVY_CONNECTOR_ID,
  privyStore,
  recentConnectorIsPrivy,
} from "./privy-store";
export type { EmbeddedWallet } from "./privy-store";

/** wagmi connector for the Privy embedded wallet. Only listed when `VITE_PRIVY_APP_ID` is set. */
export function privy() {
  const create: CreateConnectorFn<EIP1193Provider | undefined> = (config) => {
    let bound: EIP1193Provider | undefined;
    let unsubscribe: (() => void) | undefined;
    let accountsChanged: ((accounts: string[]) => void) | undefined;
    let chainChanged: ((chainId: string) => void) | undefined;
    let disconnect: (() => void) | undefined;

    const detach = () => {
      if (bound) {
        if (accountsChanged) bound.removeListener("accountsChanged", accountsChanged);
        if (chainChanged) bound.removeListener("chainChanged", chainChanged);
        if (disconnect) bound.removeListener("disconnect", disconnect);
      }
      bound = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    };

    return {
      id: PRIVY_CONNECTOR_ID,
      name: "Email",
      type: "privy",
      async connect({ chainId, withCapabilities } = {}) {
        const provider = await this.getProvider();
        if (!provider) throw new ProviderNotFoundError();
        const accounts = await this.getAccounts();
        if (accounts.length === 0) throw new ProviderNotFoundError();
        let currentChainId = await this.getChainId();
        if (chainId && currentChainId !== chainId) {
          const chain = await this.switchChain!({ chainId });
          currentChainId = chain.id;
        }
        detach();
        bound = provider;
        accountsChanged = this.onAccountsChanged.bind(this);
        chainChanged = this.onChainChanged.bind(this);
        disconnect = () => this.onDisconnect();
        provider.on("accountsChanged", accountsChanged);
        provider.on("chainChanged", chainChanged);
        provider.on("disconnect", disconnect);
        // Privy logging out elsewhere (expired session, another tab) drops the wallet.
        unsubscribe = privyStore.subscribe(() => {
          if (!privyStore.wallet) this.onDisconnect();
        });
        return {
          accounts:
            (withCapabilities
              ? accounts.map((address) => ({ address, capabilities: {} }))
              : accounts) as never,
          chainId: currentChainId,
        };
      },
      async disconnect() {
        detach();
        const logout = privyStore.logout;
        if (logout) await logout().catch(() => {});
      },
      async getAccounts() {
        const provider = await this.getProvider();
        if (!provider) throw new ProviderNotFoundError();
        const accounts = await provider.request({ method: "eth_accounts" });
        return accounts.map((a) => getAddress(a));
      },
      async getChainId() {
        const provider = await this.getProvider();
        if (!provider) throw new ProviderNotFoundError();
        const hex = await provider.request({ method: "eth_chainId" });
        return Number(hex);
      },
      async getProvider() {
        await privyStore.whenReady();
        return privyStore.wallet?.provider;
      },
      async isAuthorized() {
        try {
          const provider = await this.getProvider();
          if (!provider) return false;
          return (await this.getAccounts()).length > 0;
        } catch {
          return false;
        }
      },
      async switchChain({ chainId }) {
        const chain = config.chains.find((c) => c.id === chainId);
        if (!chain) throw new ChainNotConfiguredError();
        const provider = await this.getProvider();
        if (!provider) throw new ProviderNotFoundError();
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: numberToHex(chainId) }],
        });
        config.emitter.emit("change", { chainId });
        return chain;
      },
      onAccountsChanged(accounts) {
        if (accounts.length === 0) this.onDisconnect();
        else config.emitter.emit("change", { accounts: accounts.map((a) => getAddress(a)) });
      },
      onChainChanged(chain) {
        config.emitter.emit("change", { chainId: Number(chain) });
      },
      onDisconnect() {
        detach();
        config.emitter.emit("disconnect");
      },
    };
  };
  return createConnector(create);
}
privy.type = "privy" as const;
