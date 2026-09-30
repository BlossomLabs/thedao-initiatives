import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { useConfig, WagmiProvider } from "wagmi";
import { wagmiConfig } from "~/lib/wagmi";
import { attach } from "~/lib/wallet-island";
import { walletStore } from "~/lib/wallet-store";
import { SessionProvider } from "./session";
import { EmailSignInProvider } from "./email-sign-in";
import { ProfileDialogProvider } from "./profile-dialog";
import { WalletPickerProvider } from "./wallet-picker";

/** Transitional: mirrors the provider's config into the wallet store until the
 * island replaces the provider. */
function WalletMirror() {
  const config = useConfig();
  useLayoutEffect(() => {
    if (!walletStore.getSnapshot().attached) attach(walletStore, config, { reconnect: false });
  }, [config]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <WalletMirror />
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <EmailSignInProvider>
            <WalletPickerProvider>
              <ProfileDialogProvider>{children}</ProfileDialogProvider>
            </WalletPickerProvider>
          </EmailSignInProvider>
        </SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
