import { http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { createConfig } from "wagmi";
import { injected, mock, walletConnect } from "wagmi/connectors";
import { SITE_LOGO, SITE_NAME, SITE_URL } from "~/data/site";
import { privy, PRIVY_APP_ID } from "./privy";
import { MOCK_WALLET, WALLETCONNECT_PROJECT_ID } from "./wallet-env";

const RPC_URL = (import.meta.env?.VITE_RPC_URL as string | undefined) || undefined;
// Test votes (Sepolia); mainnet stays first, so it stays the default chain.
const SEPOLIA_RPC_URL = (import.meta.env?.VITE_SEPOLIA_RPC_URL as string | undefined) ||
  "https://ethereum-sepolia-rpc.publicnode.com";

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
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
          // Our chooser handles QR codes and wallet-specific app links.
          showQrModal: false,
          telemetryEnabled: false,
        }),
      ]
      : []),
  ],
  transports: { [mainnet.id]: http(RPC_URL), [sepolia.id]: http(SEPOLIA_RPC_URL) },
  // Created by the wallet island after hydration (lib/wallet-island.ts), never
  // during a prerender or the hydration render, so no SSR mode is needed.
  ssr: false,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
