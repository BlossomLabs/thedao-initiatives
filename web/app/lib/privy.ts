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

export const PRIVY_APP_ID = (import.meta.env?.VITE_PRIVY_APP_ID as string | undefined) ?? "";
export const PRIVY_CONNECTOR_ID = "privy";

export interface EmbeddedWallet {
  provider: EIP1193Provider;
  address: `0x${string}`;
}

type Listener = () => void;

/** True when the last wagmi connection was the email wallet (wagmi's own storage key). */
export function recentConnectorIsPrivy(): boolean {
  try {
    return localStorage.getItem("wagmi.recentConnectorId") === JSON.stringify(PRIVY_CONNECTOR_ID);
  } catch {
    return false;
  }
}

function createStore() {
  let requested = false;
  let ready = false;
  let wallet: EmbeddedWallet | undefined;
  let logout: (() => Promise<void>) | undefined;
  const listeners = new Set<Listener>();
  let resolveReady: () => void = () => {};
  const readyPromise = new Promise<void>((r) => {
    resolveReady = r;
  });
  const notify = () => listeners.forEach((l) => l());
  return {
    get ready() {
      return ready;
    },
    get wallet() {
      return wallet;
    },
    get logout() {
      return logout;
    },
    get requested() {
      return requested;
    },
    /** Privy is being loaded; `whenReady` now waits for it. */
    request() {
      requested = true;
    },
    /** Privy has restored (or ruled out) a session; safe to reconnect. */
    setReady() {
      ready = true;
      resolveReady();
      notify();
    },
    setWallet(w: EmbeddedWallet | undefined) {
      if (w === wallet || (w && wallet && w.provider === wallet.provider)) return;
      wallet = w;
      notify();
    },
    setLogout(fn: (() => Promise<void>) | undefined) {
      logout = fn;
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    /** Resolves once Privy is ready (or at once if it was never requested), or after
     * `timeoutMs`: a slow download must not block wagmi's reconnect forever. */
    whenReady(timeoutMs = 30_000): Promise<void> {
      if (ready || !requested) return Promise.resolve();
      return Promise.race([
        readyPromise,
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
      ]);
    },
    /** Resolves with the embedded wallet once one exists (created right after login). */
    waitForWallet(timeoutMs = 30_000): Promise<EmbeddedWallet> {
      if (wallet) return Promise.resolve(wallet);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error("Your wallet took too long to set up. Please try again."));
        }, timeoutMs);
        const off = this.subscribe(() => {
          if (!wallet) return;
          clearTimeout(timer);
          off();
          resolve(wallet);
        });
      });
    },
    /** Tests only. */
    reset() {
      requested = false;
      ready = false;
      wallet = undefined;
      logout = undefined;
      listeners.clear();
    },
  };
}

export const privyStore = createStore();

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
