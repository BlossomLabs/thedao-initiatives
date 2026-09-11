import { http } from "viem";
import { mainnet } from "viem/chains";
import { createConfig } from "wagmi";
import { injected, mock, walletConnect } from "wagmi/connectors";
import { SITE_LOGO, SITE_NAME, SITE_URL } from "~/data/site";
import { privy, PRIVY_APP_ID } from "./privy";

export const WALLETCONNECT_PROJECT_ID =
  (import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";
const RPC_URL = (import.meta.env?.VITE_RPC_URL as string | undefined) || undefined;

/** Dev only: a fake wallet at this address (no signing), so pages behind a
 * session can be viewed without a browser wallet. Set VITE_MOCK_WALLET. */
export const MOCK_WALLET: `0x${string}` | undefined = import.meta.env?.DEV
  ? (import.meta.env?.VITE_MOCK_WALLET as `0x${string}` | undefined) || undefined
  : undefined;

export const wagmiConfig = createConfig({
  chains: [mainnet],
  connectors: [
    ...(MOCK_WALLET ? [mock({ accounts: [MOCK_WALLET], features: { reconnect: true } })] : []),
    // Email sign-in (Privy embedded wallet), first so people without a wallet see it.
    ...(PRIVY_APP_ID ? [privy()] : []),
    injected(),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
        walletConnect({
          projectId: WALLETCONNECT_PROJECT_ID,
          metadata: {
            name: SITE_NAME,
            description: SITE_NAME,
            url: SITE_URL,
            icons: [SITE_URL + SITE_LOGO],
          },
          showQrModal: true,
        }),
      ]
      : []),
  ],
  transports: { [mainnet.id]: http(RPC_URL) },
  // Restore the stored connection in an effect, not during the hydration
  // render: prerendered pages were built disconnected and must hydrate as such.
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
