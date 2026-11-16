import { useEffect, useState } from "react";
import { api } from "~/lib/api";
import { setRound, type VoteManifest } from "../../shared/vote/manifest";

let loading: Promise<void> | null = null;

/** Learns the round the site runs now (the one admins set on Admin → Vote) and runs the
 * pages on it. Once per page load; on a failed read the page has no round. A route's
 * clientLoader awaits it before the vote shows. The head script may have started the
 * request already (early-fetch.ts), and the browser keeps the answer a few seconds. */
export function loadRound(): Promise<void> {
  loading ??= Promise.resolve()
    .then(() => api<{ manifest: VoteManifest | null }>("/api/vote/manifest"))
    .then((r) => {
      if (r?.manifest) setRound(r.manifest);
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** The round as another response carried it (the board's, during the real vote): the
 * pages run on it and loadRound() asks for nothing more. */
export function primeRound(m: VoteManifest) {
  setRound(m);
  loading = Promise.resolve();
}

/** For a route module: `export const clientLoader = roundLoader;`. */
export const roundLoader = async () => {
  await loadRound();
  return null;
};

/** True once the active round is known (a component re-renders on it): for pages that
 * show without waiting for it, like the top bar. `wanted` false: don't ask. */
export function useRoundLoaded(wanted = true): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    loadRound().then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [wanted]);
  return loaded;
}
