import { useState } from "react";
import { useSession } from "~/context/session";
import { Button } from "~/components/ui/Button";
import { errorMessage } from "~/lib/api";

/** Fresh proof is requested only after the administrator clicks. */
export default function ConfirmPrivateFields({ onConfirm }: { onConfirm: () => Promise<unknown> }) {
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
