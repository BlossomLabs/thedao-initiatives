/**
 * The Privy island: everything that needs Privy's SDK lives here, loaded
 * lazily by context/email-sign-in.tsx. It is a sibling of the app tree,
 * not a wrapper, and talks to the rest of the app only through `privyStore`
 * (lib/privy.ts), which the wagmi "Email" connector reads.
 */
import { useEffect } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import type { EIP1193Provider } from "viem";
import { mainnet } from "viem/chains";
import EmailSignInDialog from "~/components/wallet/EmailSignInDialog";
import { PRIVY_APP_ID, privyStore } from "~/lib/privy-store";
import { SITE_LOGO, SITE_URL } from "~/data/site";

/** Mirrors Privy's session and embedded wallet into `privyStore`. */
function PrivyBridge() {
  const { ready, authenticated, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const address = wallets.find((w) => w.walletClientType === "privy")?.address;

  useEffect(() => {
    privyStore.setLogout(logout);
  }, [logout]);

  useEffect(() => {
    if (!ready || !walletsReady) return;
    const wallet = authenticated && address
      ? wallets.find((w) => w.walletClientType === "privy" && w.address === address)
      : undefined;
    if (!wallet) {
      privyStore.setWallet(undefined);
      privyStore.setReady();
      return;
    }
    let cancelled = false;
    wallet.getEthereumProvider()
      .then((provider) => {
        if (cancelled) return;
        // Privy ships its own viem copy; the provider shape is the same EIP-1193 one.
        privyStore.setWallet({
          provider: provider as unknown as EIP1193Provider,
          address: wallet.address as `0x${string}`,
        });
      })
      .catch(() => {
        if (!cancelled) privyStore.setWallet(undefined);
      })
      .finally(() => {
        if (!cancelled) privyStore.setReady();
      });
    return () => {
      cancelled = true;
    };
    // `wallets` is a fresh array each render; the address is the identity that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, walletsReady, authenticated, address]);

  return null;
}

export default function PrivyIsland({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          // The site's own buttons are the confirmation step; no Privy modals
          // for the SIWE signature or donations.
          showWalletUIs: false,
        },
        defaultChain: mainnet,
        supportedChains: [mainnet],
        // Only Privy's residual UIs (recovery, MFA) use this; sign-in is our own dialog.
        appearance: { theme: "#1e3650", accentColor: "#5cb75a", logo: SITE_URL + SITE_LOGO },
      }}
    >
      <PrivyBridge />
      <EmailSignInDialog open={open} onOpenChange={onOpenChange} />
    </PrivyProvider>
  );
}
