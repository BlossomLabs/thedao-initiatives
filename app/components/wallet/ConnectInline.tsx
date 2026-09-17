import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useSession } from "~/context/session";
import { useWalletPicker } from "~/context/wallet-picker";
import { walletErrorMessage } from "~/lib/donate";
import { cn } from "~/lib/utils";

/** Blue outline button used for wallet actions inside forms. */
export const walletBtn =
  "inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-[rgba(126,179,255,.35)] bg-[rgba(44,94,134,.2)] px-3.5 font-inter-tight text-[13px] font-semibold text-dao-rfp transition-all duration-150 hover:border-[rgba(126,179,255,.6)] hover:bg-[rgba(44,94,134,.45)] hover:text-white disabled:cursor-default disabled:opacity-60";

/**
 * "Connect wallet" for use next to a form's submit button. Disconnected: the
 * same wallet chooser and SIWE flow as the header (reopening it while a
 * pairing is in flight shows that request). Connected without a session, after
 * a restore or a dismissed signature: retries the signature in place.
 */
export default function ConnectInline({ className }: { className?: string }) {
  const { connecting, signIn, signingIn } = useSession();
  const { openWalletPicker, walletPickerOpen } = useWalletPicker();
  const { isConnected } = useAccount();
  // Shown under the button until dismissed, a retry, or a successful
  // connection made anywhere on the page.
  const [error, setError] = useState("");
  useEffect(() => {
    if (isConnected) setError("");
  }, [isConnected]);

  return (
    <span className={cn("relative", className)}>
      <button
        type="button"
        className={walletBtn}
        disabled={isConnected && (connecting || signingIn)}
        aria-haspopup={isConnected ? undefined : "dialog"}
        aria-expanded={isConnected ? undefined : walletPickerOpen}
        onClick={() => {
          setError("");
          if (isConnected) {
            void signIn().catch((e) => setError("Sign-in failed: " + walletErrorMessage(e)));
          } else openWalletPicker();
        }}
      >
        <Wallet className="size-3.5" />
        {connecting || signingIn
          ? "Check your wallet…"
          : isConnected
          ? "Sign in"
          : "Connect wallet"}
      </button>
      {error && (
        <span
          className="absolute left-0 top-[44px] z-[60] w-max max-w-[280px] rounded-xl border border-[rgba(255,59,56,.55)] bg-panel px-3 py-2 text-[12.5px] text-[#ffd7d6] shadow-menu"
          role="alert"
          onClick={() => setError("")}
        >
          {error}
        </span>
      )}
    </span>
  );
}
