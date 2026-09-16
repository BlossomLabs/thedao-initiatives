export interface MobileWallet {
  id: string;
  name: string;
  native: string | null;
  universal: string | null;
}

/** Registry data is untrusted. Only app schemes and HTTPS links are usable. */
export function safeWalletLink(value: unknown, universal = false): string | null {
  if (typeof value !== "string" || !value || /[\s\\<>]/.test(value)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    if (
      universal
        ? url.protocol !== "https:"
        : /^(https?|javascript|data|file|blob|intent|about):$/i.test(url.protocol)
    ) return null;
    // Ambiguous nested redirects need wallet-specific handling. Keep the wallet
    // in the directory, with QR/copy available, instead of guessing its format.
    if ([...url.searchParams.keys()].some((key) => key !== "uri")) return null;
    return value.split("?")[0];
  } catch {
    return null;
  }
}

/** One WalletConnect pairing works with every compatible wallet. */
export function walletDeepLink(wallet: MobileWallet, uri?: string): string | null {
  const base = safeWalletLink(wallet.native) ?? safeWalletLink(wallet.universal, true);
  if (!base) return null;
  if (!uri) return base;
  if (!/^wc:[^\s]+@2\?/.test(uri)) return null;
  // Some registry entries already include /wc (or /wc/connect).
  const endpoint = /(?:\/\/|\/)(?:wc(?:\/connect)?|wcV2|wccallback|wcx)\/?$/i.test(base)
    ? base.replace(/\/$/, "")
    : `${base.endsWith("/") ? base : `${base}/`}wc`;
  return `${endpoint}?uri=${encodeURIComponent(uri)}`;
}

export function normalizeWallets(listings: unknown): MobileWallet[] {
  if (!listings || typeof listings !== "object") throw new Error("Invalid wallet directory.");
  const wallets = Object.values(listings).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const w = entry as Record<string, unknown>;
    if (typeof w.id !== "string" || typeof w.name !== "string" || !w.name.trim()) return [];
    const mobile = w.mobile as Record<string, unknown> | undefined;
    return [{
      id: w.id,
      name: w.name.trim(),
      native: safeWalletLink(mobile?.native ?? w.native),
      universal: safeWalletLink(mobile?.universal ?? w.universal, true),
    }];
  });
  return [...new Map(wallets.map((w) => [w.id, w])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export function metaMaskBrowserLink(
  location: Pick<Location, "host" | "pathname" | "search" | "hash">,
) {
  return `https://metamask.app.link/dapp/${location.host}${location.pathname}${location.search}${location.hash}`;
}
