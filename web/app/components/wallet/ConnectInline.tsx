import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useSession } from "~/context/session";
import { useConnectors } from "~/hooks/use-connectors";
import { walletErrorMessage } from "~/lib/donate";
import { cn } from "~/lib/utils";
import WalletMenu, { connectorIcon } from "./WalletMenu";

/** Blue outline button used for wallet actions inside forms. */
export const walletBtn =
  "inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-[rgba(126,179,255,.35)] bg-[rgba(44,94,134,.2)] px-3.5 font-inter-tight text-[13px] font-semibold text-dao-rfp transition-all duration-150 hover:border-[rgba(126,179,255,.6)] hover:bg-[rgba(44,94,134,.45)] hover:text-white disabled:cursor-default disabled:opacity-60";

/**
 * "Connect wallet" for use next to a form's submit button. Same flow as the
 * top-bar button: connect and sign in in one step, and a dismissed signature
 * leaves the wallet disconnected so the button can simply be clicked again.
 */
export default function ConnectInline({ className }: { className?: string }) {
  const connectors = useConnectors();
  const { connect, connecting } = useSession();
  const { isConnected } = useAccount();
  const [pick, setPick] = useState(false);
  // Shown under the button until dismissed, a retry, or a successful
  // connection made anywhere on the page.
  const [error, setError] = useState("");
  useEffect(() => {
    if (isConnected) setError("");
  }, [isConnected]);

  async function connectWith(c: (typeof connectors)[number]) {
    setError("");
    try {
      await connect(c);
    } catch (e) {
      setError("Not connected: " + walletErrorMessage(e));
    }
  }

  return (
    <span className={cn("relative", className)}>
      <button
        type="button"
        className={walletBtn}
        disabled={connecting}
        aria-haspopup={connectors.length > 1 ? "menu" : undefined}
        aria-expanded={connectors.length > 1 ? pick : undefined}
        onClick={() => {
          if (connectors.length === 1) void connectWith(connectors[0]);
          else setPick((v) => !v);
        }}
      >
        <Wallet className="size-3.5" />
        {connecting ? "Check your wallet…" : "Connect wallet"}
      </button>
      {pick && (
        <WalletMenu
          className="left-0 right-auto top-[40px]"
          onClose={() => setPick(false)}
          items={connectors.map((c) => ({
            key: c.uid,
            label: c.name,
            icon: connectorIcon(c),
            lucide: connectorIcon(c) ? undefined : "wallet",
            onClick: () => void connectWith(c),
          }))}
        />
      )}
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
