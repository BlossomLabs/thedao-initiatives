/** Wallet settings read from the build environment. Their own module, free of
 * wagmi and viem, so pages can read them without loading the wallet stack. */
export const WALLETCONNECT_PROJECT_ID =
  (import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";

/** Dev only: a fake wallet at this address (no signing), so pages behind a
 * session can be viewed without a browser wallet. Set VITE_MOCK_WALLET. */
export const MOCK_WALLET: `0x${string}` | undefined = import.meta.env?.DEV
  ? (import.meta.env?.VITE_MOCK_WALLET as `0x${string}` | undefined) || undefined
  : undefined;
