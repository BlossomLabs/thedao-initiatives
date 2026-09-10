import { useEffect, useRef, useState } from "react";
import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { useConfig } from "wagmi";
import { Dialog } from "~/components/ui/Dialog";
import { Button } from "~/components/ui/Button";
import { Field, Input } from "~/components/ui/Field";
import { useSession } from "~/context/session";
import { PRIVY_CONNECTOR_ID, privyStore } from "~/lib/privy";
import { walletErrorMessage } from "~/lib/donate";

type Step = "email" | "code" | "finishing";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign in with an email code (Privy, headless). After the code checks out
 * Privy creates or restores the user's embedded wallet, and the site then
 * signs in with Ethereum through it exactly as with a browser wallet, so
 * "connected" still means "signed in".
 */
export default function EmailSignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { authenticated } = usePrivy();
  const { connect } = useSession();
  const config = useConfig();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function finish() {
    setStep("finishing");
    setBusy(true);
    try {
      await privyStore.waitForWallet();
      const c = config.connectors.find((x) => x.id === PRIVY_CONNECTOR_ID);
      if (!c) throw new Error("Email sign-in is not available.");
      await connect(c);
      if (alive.current) onOpenChange(false);
    } catch (e) {
      if (!alive.current) return;
      // connect() already logged out of Privy on failure; start over.
      setError("Not signed in: " + walletErrorMessage(e));
      setStep("email");
      setCode("");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  // Reset on open. A Privy session left over from an earlier attempt (say a
  // failed sign-in whose logout did not go through) is reused directly.
  useEffect(() => {
    if (!open) return;
    setError("");
    setCode("");
    setBusy(false);
    if (authenticated && privyStore.wallet) void finish();
    else setStep("email");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submitEmail() {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendCode({ email: value });
      setStep("code");
    } catch (e) {
      setError("Could not send the code: " + walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    const value = code.replace(/\D/g, "");
    if (value.length < 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await loginWithCode({ code: value });
    } catch (e) {
      setError("That code did not work: " + walletErrorMessage(e));
      setBusy(false);
      return;
    }
    await finish();
  }

  const onKey = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy && step === "finishing") return;
        onOpenChange(o);
      }}
      title={step === "code" ? "Check your email" : "Sign in with email"}
      description={step === "email"
        ? "No wallet needed. We email you a one-time code and set up a wallet for you."
        : step === "code"
        ? `We sent a 6-digit code to ${email.trim()}.`
        : "Setting up your wallet and signing you in…"}
    >
      {step === "email" && (
        <>
          <Field label="Email" htmlFor="email-signin">
            <Input
              id="email-signin"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.org"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onKey(() => void submitEmail())}
            />
          </Field>
          {error && <p className="m-0 text-[12.5px] text-[#ffd7d6]" role="alert">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" variant="ghost" sm onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1" variant="primary" sm loading={busy} onClick={submitEmail}>
              Send code
            </Button>
          </div>
        </>
      )}
      {step === "code" && (
        <>
          <Field label="Code" htmlFor="email-code">
            <Input
              id="email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              className="tracking-[.3em]"
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={onKey(() => void submitCode())}
            />
          </Field>
          {error && <p className="m-0 text-[12.5px] text-[#ffd7d6]" role="alert">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button
              className="flex-1"
              variant="ghost"
              sm
              disabled={busy}
              onClick={() => {
                setError("");
                setStep("email");
              }}
            >
              Change email
            </Button>
            <Button className="flex-1" variant="primary" sm loading={busy} onClick={submitCode}>
              Sign in
            </Button>
          </div>
          <button
            type="button"
            className="mt-1 self-start border-0 bg-transparent p-0 text-[12.5px] text-dao-rfp underline-offset-2 hover:underline disabled:opacity-60"
            disabled={busy}
            onClick={() => void submitEmail()}
          >
            Resend code
          </button>
        </>
      )}
      {step === "finishing" && (
        <div className="flex items-center gap-2 py-2 text-[13px] text-soft">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          One moment…
        </div>
      )}
    </Dialog>
  );
}
