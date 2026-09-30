import { useId, useState } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "~/components/ui/Button";
import { ApiError } from "~/lib/api";
import { plural } from "~/lib/format";
import { writeAsk } from "~/lib/watchlist-local";
import { moveToAccount } from "~/hooks/use-watchlist-offer";

/** The offer to move this browser's watchlist to the account. Not modal: it never takes focus.
 * "Don't ask again" remembers the answer it is ticked with, for this account. */
export default function WatchlistOffer(
  { count, address, expiresAt, onDone }: {
    count: number;
    address: string;
    expiresAt: number;
    onDone: (moved: boolean) => void;
  },
) {
  const qc = useQueryClient();
  const ids = useId();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const move = async () => {
    setBusy(true);
    setError("");
    try {
      const moved = await moveToAccount(qc, address);
      if (remember) writeAsk(address, "always");
      onDone(moved !== null);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 400
          ? "Your watchlist is over 200 initiatives. Remove some and try again."
          : "Couldn't move your watchlist. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const later = () => {
    writeAsk(address, remember ? "never" : `later:${expiresAt}`);
    onDone(false);
  };

  return (
    <section
      aria-labelledby={`${ids}-t`}
      className="relative w-[420px] rounded-[14px] border border-edge2 bg-panel p-4 text-left shadow-menu max-[640px]:w-auto"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={later}
        disabled={busy}
        className="absolute right-2 top-2 grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/60 hover:text-white"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <h2 id={`${ids}-t`} className="m-0 pr-8 font-inter-tight text-[15px] font-medium text-white">
        Keep your watchlist on your account?
      </h2>
      <p className="mb-3 mt-1.5 text-[13px] leading-[1.5] text-white/65">
        You have {plural(count, "initiative")}{" "}
        on this browser's watchlist. Move them to your account to see them wherever you sign in.
      </p>
      {error && <p className="mb-3 mt-0 text-[13px] text-dao-red">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" sm onClick={() => void move()} disabled={busy}>
          Move to my account
        </Button>
        <Button variant="ghost" sm onClick={later} disabled={busy}>Not now</Button>
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-white/60">
          <input
            type="checkbox"
            checked={remember}
            disabled={busy}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Don't ask again
        </label>
      </div>
    </section>
  );
}
