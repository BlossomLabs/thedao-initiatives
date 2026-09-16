import { Wallet } from "lucide-react";
import { useSession } from "~/context/session";
import { useWalletPicker } from "~/context/wallet-picker";
import { cn } from "~/lib/utils";

/** Blue outline button used for wallet actions inside forms. */
export const walletBtn =
  "inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-[rgba(126,179,255,.35)] bg-[rgba(44,94,134,.2)] px-3.5 font-inter-tight text-[13px] font-semibold text-dao-rfp transition-all duration-150 hover:border-[rgba(126,179,255,.6)] hover:bg-[rgba(44,94,134,.45)] hover:text-white disabled:cursor-default disabled:opacity-60";

/** The same wallet chooser and SIWE flow used by the header. */
export default function ConnectInline({ className }: { className?: string }) {
  const { connecting, signingIn } = useSession();
  const { openWalletPicker, walletPickerOpen } = useWalletPicker();
  return (
    <button
      type="button"
      className={cn(walletBtn, className)}
      aria-haspopup="dialog"
      aria-expanded={walletPickerOpen}
      onClick={openWalletPicker}
    >
      <Wallet className="size-3.5" />
      {connecting || signingIn ? "Check your wallet…" : "Connect wallet"}
    </button>
  );
}
