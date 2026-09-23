import { Outlet } from "react-router";
import { useAccount } from "wagmi";
import PageMain from "~/components/layout/PageMain";
import { Button } from "~/components/ui/Button";
import { useSession } from "~/context/session";
import { useWalletPicker } from "~/context/wallet-picker";
import { walletErrorMessage } from "~/lib/donate";
import { useState } from "react";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Admin", url: "/admin", noIndex: true });
}

/** Gate: everything under /admin needs a SIWE session from an admin wallet. */
export default function AdminLayout() {
  const { session, signIn, signingIn } = useSession();
  const { openWalletPicker } = useWalletPicker();
  const { isConnected, address } = useAccount();
  const [error, setError] = useState("");
  if (session?.isAdmin) return <Outlet />;
  return (
    <PageMain narrow detail className="min-h-[60vh]">
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        Admin
      </h1>
      <p className="mt-3.5 font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        Sign in with an admin wallet. One signature, no transaction, no gas.
      </p>
      <div className="panel mt-5 flex flex-col gap-3">
        {!isConnected && (
          <p className="m-0 small">
            Connect your wallet with the button in the top right; you will be asked to sign in.
          </p>
        )}
        {isConnected && !session?.isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              loading={signingIn}
              onClick={() =>
                signIn().catch((e) => setError("Not signed in: " + walletErrorMessage(e)))}
            >
              Sign in with {address?.slice(0, 6)}…
            </Button>
            <Button variant="ghost" disabled={signingIn} onClick={openWalletPicker}>
              Use a different wallet
            </Button>
          </div>
        )}
        {session && !session.isAdmin && (
          <p className="m-0 small text-[#ffd7d6]" role="alert">
            This session has no administrator access. If this wallet was recently added as an
            administrator, sign in again to activate that access.
          </p>
        )}
        {error && <p className="m-0 small text-[#ffd7d6]" role="alert">{error}</p>}
      </div>
    </PageMain>
  );
}
