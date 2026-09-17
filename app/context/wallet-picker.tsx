import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState } from "react";
import { Dialog } from "~/components/ui/Dialog";

const WalletPicker = lazy(() => import("~/components/wallet/WalletPicker"));
const Ctx = createContext<{ openWalletPicker(): void; walletPickerOpen: boolean } | null>(null);

export function WalletPickerProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const openWalletPicker = useCallback(() => {
    setLoaded(true);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ openWalletPicker, walletPickerOpen: open }), [
    openWalletPicker,
    open,
  ]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {loaded && (
        <Suspense
          fallback={
            <Dialog open={open} onOpenChange={setOpen} title="Connect wallet">
              Loading wallets…
            </Dialog>
          }
        >
          {
            /* Keep an in-flight pairing alive when the dialog is hidden. Reopening
              shows that same request instead of creating competing sessions. */
          }
          <WalletPicker open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}

export function useWalletPicker() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useWalletPicker outside WalletPickerProvider");
  return value;
}
