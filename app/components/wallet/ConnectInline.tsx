import { Wallet } from "lucide-react";
import { useWallet } from "~/context/wallet";
import { useSession } from "~/context/session";
import { useWalletPicker } from "~/context/wallet-picker";
import { cn } from "~/lib/utils";

/** Blue outline button used for wallet actions inside forms. */
export const walletBtn =
  "inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-[rgba(126,179,255,.35)] bg-[rgba(44,94,134,.2)] px-3.5 font-inter-tight text-[13px] font-semibold text-dao-rfp transition-all duration-150 hover:border-[rgba(126,179,255,.6)] hover:bg-[rgba(44,94,134,.45)] hover:text-white disabled:cursor-default disabled:opacity-60";

/**
 * "Connect wallet" for use next to a form's submit button. Disconnected: the
 * same wallet chooser and SIWE flow as the header (reopening it while a
 * pairing is in flight shows that request). Connected without a session, after
 * a restore or a dismissed signature: the chooser too, so another wallet or
 * email stays reachable; picking the connected wallet retries the signature.
 */
export default function ConnectInline({ className }: { className?: string }) {
  const { connecting, signingIn } = useSession();
  const { openWalletPicker, walletPickerOpen } = useWalletPicker();
  const { isConnected } = useWallet();

  return (
    <span className={cn("relative", className)}>
      <button
        type="button"
        className={walletBtn}
        disabled={isConnected && (connecting || signingIn)}
        aria-haspopup="dialog"
        aria-expanded={walletPickerOpen}
        onClick={openWalletPicker}
      >
        <Wallet className="size-3.5" />
        {connecting || signingIn
          ? "Check your wallet…"
          : isConnected
          ? "Sign in"
          : "Connect wallet"}
      </button>
    </span>
  );
}
