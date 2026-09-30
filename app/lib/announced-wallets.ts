/**
 * The wallets this browser announces (EIP-6963), found without wagmi, so the
 * wallet chooser can list them while the wallet island is still loading.
 * wagmi's own discovery (mipd) lists the same wallets once it is up, one
 * connector per rdns, after the configured connectors.
 */
export interface AnnouncedWallet {
  rdns: string;
  name: string;
  icon: string;
}

let wallets: readonly AnnouncedWallet[] = [];
const listeners = new Set<() => void>();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  globalThis.addEventListener("eip6963:announceProvider", (e) => {
    const info = (e as CustomEvent<{ info?: Partial<AnnouncedWallet> }>).detail?.info;
    if (!info || typeof info.rdns !== "string" || typeof info.name !== "string") return;
    if (wallets.some((w) => w.rdns === info.rdns)) return;
    const icon = typeof info.icon === "string" ? info.icon : "";
    wallets = [...wallets, { rdns: info.rdns, name: info.name, icon }];
    for (const l of listeners) l();
  });
  globalThis.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function subscribeAnnouncedWallets(listener: () => void) {
  listen();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getAnnouncedWallets = () => wallets;
const none: readonly AnnouncedWallet[] = [];
export const getServerAnnouncedWallets = () => none;

/** What wagmi's generic `injected()` connector would find. */
export const hasInjectedProvider = () =>
  typeof window !== "undefined" && Boolean((globalThis as { ethereum?: unknown }).ethereum);
