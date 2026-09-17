import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "~/lib/wagmi";
import { SessionProvider } from "./session";
import { EmailSignInProvider } from "./email-sign-in";
import { ProfileDialogProvider } from "./profile-dialog";
import { WalletPickerProvider } from "./wallet-picker";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
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
