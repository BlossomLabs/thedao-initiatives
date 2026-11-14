import { useState } from "react";
import { useSession } from "~/context/session";
import { Button } from "~/components/ui/Button";
import { errorMessage } from "~/lib/api";

/**
 * Fresh proof is requested only after the administrator clicks. `inline` is the
 * form for a table cell: the hidden value itself is the button, its title says why.
 */
export default function ConfirmPrivateFields(
  { onConfirm, inline = false }: { onConfirm: () => Promise<unknown>; inline?: boolean },
) {
  const { signIn } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await signIn();
      await onConfirm();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (inline) {
    return (
      <>
        <button
          type="button"
          disabled={busy}
          title="Contacts are private: click to sign with your wallet and show them (no transaction, no gas)."
          onClick={() => void confirm()}
          className="cursor-pointer border-0 bg-transparent p-0 text-inherit text-muted underline decoration-dotted decoration-white/30 underline-offset-2 hover:text-white disabled:cursor-default disabled:opacity-60"
        >
          {busy ? "Confirming…" : "Hidden"}
        </button>
        {error && <span className="fld-msg fld-err mt-1 block" role="alert">{error}</span>}
      </>
    );
  }
  return (
    <div className="my-3">
      <p className="small dim">Private contacts require a fresh wallet signature.</p>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => void confirm()}>
        {busy ? "Confirming…" : "Confirm wallet to view contacts"}
      </Button>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
