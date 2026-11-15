import { useEffect, useState } from "react";
import { api } from "~/lib/api";
import { setRound, type VoteManifest } from "../../shared/vote/manifest";

let loading: Promise<void> | null = null;

/** Learns the round the site runs now (an admin may have put a Sepolia test round in
 * place of the built-in one) and runs the pages on it. Once per page load; on a failed
 * read the built-in round stays. A route's clientLoader awaits it before the vote shows. */
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
