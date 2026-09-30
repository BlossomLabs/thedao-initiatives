/**
 * The Privy side of email sign-in that the rest of the app talks to: the app
 * id, the connector id, and the store through which the React bridge
 * (context/privy.tsx) hands the embedded wallet's EIP-1193 provider to the
 * wagmi connector in privy.ts. Free of wagmi and viem at runtime, so the
 * pages that only ask "was the last wallet the email one?" stay light.
 */
import type { EIP1193Provider } from "viem";

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
