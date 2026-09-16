import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useSession } from "~/context/session";
import { useEmailSignIn } from "~/context/email-sign-in";
import { PRIVY_CONNECTOR_ID } from "~/lib/privy";
import { useConnectors } from "~/hooks/use-connectors";
import { walletErrorMessage } from "~/lib/donate";
import { cn } from "~/lib/utils";
import WalletMenu, { connectorItem } from "./WalletMenu";

/** Blue outline button used for wallet actions inside forms. */
export const walletBtn =
  "inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-[rgba(126,179,255,.35)] bg-[rgba(44,94,134,.2)] px-3.5 font-inter-tight text-[13px] font-semibold text-dao-rfp transition-all duration-150 hover:border-[rgba(126,179,255,.6)] hover:bg-[rgba(44,94,134,.45)] hover:text-white disabled:cursor-default disabled:opacity-60";

/**
 * "Connect wallet" for use next to a form's submit button. Same flow as the
 * top-bar button: connect and sign in in one step, or retry signing in with
 * an already-connected wallet after a restore or dismissed signature.
 */
export default function ConnectInline({ className }: { className?: string }) {
  const connectors = useConnectors();
  const { connect, connecting, signIn, signingIn } = useSession();
  const { openEmailSignIn } = useEmailSignIn();
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
    if (c.id === PRIVY_CONNECTOR_ID) {
      openEmailSignIn();
      return;
    }
    try {
      await connect(c);
    } catch (e) {
      setError("Sign-in failed: " + walletErrorMessage(e));
    }
  }

  return (
    <span className={cn("relative", className)}>
      <button
        type="button"
        className={walletBtn}
        disabled={connecting || signingIn}
        aria-haspopup={!isConnected && connectors.length > 1 ? "menu" : undefined}
        aria-expanded={!isConnected && connectors.length > 1 ? pick : undefined}
        onClick={() => {
          setError("");
          if (isConnected) {
            void signIn().catch((e) => setError("Sign-in failed: " + walletErrorMessage(e)));
          } else if (connectors.length === 1) void connectWith(connectors[0]);
          else setPick((v) => !v);
        }}
      >
        <Wallet className="size-3.5" />
        {connecting || signingIn
          ? "Check your wallet…"
          : isConnected
          ? "Sign in"
          : "Connect wallet"}
      </button>
      {pick && !isConnected && (
        <WalletMenu
          className="left-0 right-auto top-[40px]"
          onClose={() => setPick(false)}
          items={connectors.map((c) => connectorItem(c, () => void connectWith(c)))}
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
