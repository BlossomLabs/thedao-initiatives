import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { plural } from "~/lib/format";
import { moveToAccount, useWatchlistOffer } from "~/hooks/use-watchlist-offer";

const WatchlistOffer = lazy(() => import("./WatchlistOffer"));
const MOVED_MS = 4000;

/** Under the wallet button: the offer while it applies (or the move itself, when the
 * account said "always"). A successful move just closes the card; only the status element says so. */
export default function WatchlistOfferSlot() {
  const offer = useWatchlistOffer();
  const qc = useQueryClient();
  const [moved, setMoved] = useState(false);
  // One automatic try per sign-in; a failure waits for the next one.
  const tried = useRef("");

  useEffect(() => {
    const signIn = `${offer.address}:${offer.expiresAt}`;
    if (offer.mode !== "auto" || tried.current === signIn) return;
    tried.current = signIn;
    moveToAccount(qc, offer.address).then((ids) => ids && setMoved(true), () => {});
  }, [offer.mode, offer.address, offer.expiresAt, qc]);

  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(false), MOVED_MS);
    return () => clearTimeout(t);
  }, [moved]);

  // One polite status element that is always mounted: its text changing is what gets announced
  // (a live region that mounts already filled is often skipped). The card itself is silent.
  const status = offer.mode === "ask"
    ? `Keep your watchlist on your account? You have ${
      plural(offer.count, "initiative")
    } on this browser's watchlist.`
    : moved
    ? "Watchlist moved to your account."
    : "";
  return (
    <>
      <p role="status" className="sr-only">{status}</p>
      {offer.mode === "ask" && (
        <div className="absolute right-0 top-full z-[70] mt-2 max-[640px]:fixed max-[640px]:inset-x-4 max-[640px]:top-[64px]">
          <Suspense fallback={null}>
            <WatchlistOffer
              count={offer.count}
              address={offer.address}
              expiresAt={offer.expiresAt}
              onDone={(m) => m && setMoved(true)}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
