import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "~/lib/utils";
import PageMain from "~/components/layout/PageMain";
import { Button } from "~/components/ui/Button";
import { Field, Input } from "~/components/ui/Field";
import ConnectInline from "~/components/wallet/ConnectInline";
import { sessionKey, useSession } from "~/context/session";
import { api, errorMessage } from "~/lib/api";
import { generateMeta } from "~/utils/meta";

interface ManagedSession {
  id: string;
  isAdmin: boolean;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

export function meta() {
  return generateMeta({ title: "Sessions", url: "/sessions", noIndex: true });
}

const date = (time: number) => new Date(time * 1000).toLocaleString();

export default function Sessions() {
  const { session, signIn, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  // The answer to a button shows next to it (`at`), not at the top of a long page.
  const [said, setSaid] = useState<{ at: string; error?: string; notice?: string } | null>(null);
  const [target, setTarget] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const inventory = useQuery({
    queryKey: ["sessions", sessionKey(session)],
    queryFn: ({ signal }) => api<{ sessions: ManagedSession[] }>("/api/auth/sessions", { signal }),
    enabled: Boolean(session),
    // Background polling would keep an unattended session alive.
    refetchOnWindowFocus: false,
    gcTime: 0,
  });

  async function manage(at: string, path: string, json?: unknown, signOutAfter = false) {
    setBusy(true);
    setSaid(null);
    try {
      // Always request a new wallet signature for remote/global termination.
      // Reauthentication rotates the current token without ending other devices.
      const revoke = async () => {
        await signIn();
        await api(path, json === undefined ? { method: "DELETE" } : { json });
      };
      if (signOutAfter) {
        if (!await signOut(revoke)) return;
      } else {
        await revoke();
        await inventory.refetch();
      }
      setSaid({ at, notice: "Sessions revoked." });
    } catch (e) {
      setSaid({ at, error: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const answer = (at: string, className = "mt-3 mb-0") =>
    said?.at === at &&
    (said.error
      ? <p className={cn("alert", className)} role="alert">{said.error}</p>
      : <p className={cn("small", className)} role="status">{said.notice}</p>);

  return (
    <PageMain narrow detail className="min-h-[60vh]">
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        Sessions
      </h1>
      <p className="mt-3.5 font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        Review where your wallet is signed in. Ending other sessions asks for a fresh wallet
        signature.
      </p>
      {!session && (
        <p className="flex flex-wrap items-center gap-3">
          <span className="small dim">Sign in to manage your sessions.</span>
          <ConnectInline />
        </p>
      )}
      {session && (
        <>
          <p className="small dim">
            Sessions end after one day without activity, or seven days after sign-in.
          </p>
          {inventory.isLoading && <p className="small dim">Loading sessions…</p>}
          {inventory.error && <p className="alert" role="alert">{errorMessage(inventory.error)}</p>}
          <ul className="m-0 mt-6 list-none p-0" aria-label="Active sessions">
            {inventory.data?.sessions.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-4 border-0 border-t border-solid border-white/10 py-4"
              >
                <div>
                  <p className="m-0 font-inter-tight text-[16px]">
                    {row.current ? "This session" : "Another session"}
                    {row.isAdmin && <span className="chip chip-badge ml-2">Admin</span>}
                  </p>
                  <p className="small dim mb-0">
                    Signed in {date(row.createdAt)}
                    <br />
                    Last active {date(row.lastSeenAt)}
                    <br />
                    Expires {date(row.expiresAt)}
                  </p>
                </div>
                <Button
                  sm
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    row.current
                      ? void signOut()
                      : void manage(row.id, `/api/auth/sessions/${row.id}`)}
                >
                  {row.current ? "Sign out" : "End session"}
                </Button>
                {answer(row.id, "my-0 basis-full")}
              </li>
            ))}
          </ul>
          <Button
            className="mt-5"
            variant="danger"
            disabled={busy}
            onClick={() => void manage("everywhere", "/api/auth/logout-all", {}, true)}
          >
            Sign out everywhere
          </Button>
          {answer("everywhere")}
          {session.isAdmin && (
            <section className="panel mt-8" aria-labelledby="admin-session-heading">
              <h2
                id="admin-session-heading"
                className="m-0 font-inter-tight text-[22px] font-medium"
              >
                Administrator controls
              </h2>
              <p className="small dim">
                Use these controls to end access after a suspected compromise.
              </p>
              <Field label="Wallet address" htmlFor="revoke-wallet">
                <Input
                  id="revoke-wallet"
                  value={target}
                  onChange={(e) =>
                    setTarget(e.target.value)}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Button
                variant="danger"
                className="mt-3"
                disabled={busy || !/^0x[a-fA-F0-9]{40}$/.test(target.trim())}
                onClick={() =>
                  void manage(
                    "wallet",
                    "/api/admin/sessions/revoke",
                    { address: target.trim() },
                    target.trim().toLowerCase() === session.address.toLowerCase(),
                  )}
              >
                Revoke this wallet’s sessions
              </Button>
              {answer("wallet")}
              <Field
                label="Revoke every session on the site"
                htmlFor="revoke-confirmation"
                hint="Includes your session. Type “revoke all sessions” to confirm."
              >
                <Input
                  id="revoke-confirmation"
                  value={confirmation}
                  onChange={(e) =>
                    setConfirmation(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Button
                variant="danger"
                className="mt-3"
                disabled={busy || confirmation !== "revoke all sessions"}
                onClick={() =>
                  void manage("global", "/api/admin/sessions/revoke-all", { confirmation }, true)}
              >
                Revoke all sessions
              </Button>
              {answer("global")}
            </section>
          )}
        </>
      )}
    </PageMain>
  );
}
