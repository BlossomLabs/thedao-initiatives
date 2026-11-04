import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { afterLoad } from "~/lib/after-load";
import { useWalletStore } from "./wallet";

// Not in the first load (it competed with the board's data on slow links), but
// fetched once the page is idle, so the chooser still opens complete at once in
// practice; a click before that loads it then. Its rows stay disabled until the
// wallet island is up.
let picker: Promise<typeof import("~/components/wallet/WalletPicker")> | null = null;
const loadPicker = () =>
  picker ??= import("~/components/wallet/WalletPicker").catch((e) => {
    picker = null;
    throw e;
  });
const WalletPicker = lazy(loadPicker);

const Ctx = createContext<{ openWalletPicker(): void; walletPickerOpen: boolean } | null>(null);

export function WalletPickerProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const wallet = useWalletStore();
  useEffect(() => afterLoad(() => void loadPicker().catch(() => {})), []);
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
        // Stays mounted once opened: closing drops a WalletConnect request, but a
        // browser wallet's stays open in its popup, and reopening shows it.
        <Suspense fallback={null}>
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
