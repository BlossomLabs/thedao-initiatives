/**
 * One shared email sign-in dialog, opened from any "Connect wallet" picker
 * when the user chooses "Email". Privy's SDK is heavy, so the island that
 * hosts it (context/privy.tsx) is only loaded when someone picks Email or
 * comes back with an email session; wallet users never download it.
 * A no-op when Privy is not configured (the option is not listed then either).
 */
import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState } from "react";
import { Dialog } from "~/components/ui/Dialog";
import { PRIVY_APP_ID, privyStore, recentConnectorIsPrivy } from "~/lib/privy";

const PrivyIsland = lazy(() => import("./privy"));

interface EmailSignInCtx {
  emailSignInOpen: boolean;
  openEmailSignIn(): void;
}

const Ctx = createContext<EmailSignInCtx | null>(null);

/** Shown while the Privy chunk downloads after a click on "Email". */
function Loading({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Sign in with email">
      <div className="flex items-center gap-2 py-2 text-[13px] text-soft">
        <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        Loading…
      </div>
    </Dialog>
  );
}

export function EmailSignInProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Decided during the first render, before wagmi's reconnect effect runs, so
  // the connector knows whether to wait for Privy.
  const [load, setLoad] = useState(() => {
    const wanted = Boolean(PRIVY_APP_ID) && recentConnectorIsPrivy();
    if (wanted) privyStore.request();
    return wanted;
  });
  const openEmailSignIn = useCallback(() => {
    if (!PRIVY_APP_ID) return;
    privyStore.request();
    setLoad(true);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ emailSignInOpen: open, openEmailSignIn }), [
    open,
    openEmailSignIn,
  ]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {load && (
        <Suspense fallback={<Loading open={open} onOpenChange={setOpen} />}>
          <PrivyIsland open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}

export function useEmailSignIn(): EmailSignInCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEmailSignIn outside EmailSignInProvider");
  return v;
}
