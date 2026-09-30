import { createContext, useCallback, useContext, useMemo, useState } from "react";
// Loaded with the page (no wagmi at runtime), so the chooser opens complete
// at once; its rows stay disabled until the wallet island is up.
import WalletPicker from "~/components/wallet/WalletPicker";
import { useWalletStore } from "./wallet";

const Ctx = createContext<{ openWalletPicker(): void; walletPickerOpen: boolean } | null>(null);

export function WalletPickerProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const wallet = useWalletStore();
  const openWalletPicker = useCallback(() => {
    void wallet.load().catch(() => {});
    setLoaded(true);
    setOpen(true);
  }, [wallet]);
  const value = useMemo(() => ({ openWalletPicker, walletPickerOpen: open }), [
    openWalletPicker,
    open,
  ]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {loaded && (
        // Keep an in-flight pairing alive when the dialog is hidden. Reopening
        // shows that same request instead of creating competing sessions.
        <WalletPicker open={open} onOpenChange={setOpen} />
      )}
    </Ctx.Provider>
  );
}

export function useWalletPicker() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useWalletPicker outside WalletPickerProvider");
  return value;
}
