import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { api, type ApiOptions } from "~/lib/api";
import { checkManifest, NO_ROUND, type VoteManifest } from "../../shared/vote/manifest";
import {
  environmentForPath,
  voteBase,
  type VoteEnvironment,
  voteEnvironment,
} from "../../shared/vote/environment";

export const VoteEnvironmentContext = createContext<VoteEnvironment>("production");
export const useVoteEnvironment = () => useContext(VoteEnvironmentContext);
const rounds: Record<VoteEnvironment, VoteManifest> = { production: NO_ROUND, test: NO_ROUND };
const loading: Partial<Record<VoteEnvironment, Promise<void>>> = {};
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function useRound() {
  const env = useVoteEnvironment();
  return useSyncExternalStore(subscribe, () => rounds[env], () => NO_ROUND);
}
/** One environment's round whatever page this is (`wanted`: load it if not yet). The vote's
 * examples borrow the production round's affiliations on /vote-test (#144). */
export function useRoundOf(env: VoteEnvironment, wanted = true) {
  useEffect(() => {
    if (wanted && rounds[env] === NO_ROUND) void loadRound(env);
  }, [env, wanted]);
  return useSyncExternalStore(subscribe, () => rounds[env], () => NO_ROUND);
}
export const useVoteBase = () => voteBase(useVoteEnvironment());
export function primeRound(m: VoteManifest, env: VoteEnvironment = voteEnvironment(m)) {
  if (voteEnvironment(m) !== env) throw new Error("Vote environment mismatch");
  rounds[env] = checkManifest(m);
  listeners.forEach((fn) => fn());
}
export function loadRound(env: VoteEnvironment = "production"): Promise<void> {
  return loading[env] ??= api<{ manifest: VoteManifest | null }>(`/api${voteBase(env)}/manifest`)
    .then((r) => {
      if (r.manifest) primeRound(r.manifest, env);
      else {
        rounds[env] = NO_ROUND;
        listeners.forEach((fn) => fn());
      }
    }).catch(() => {
      rounds[env] = NO_ROUND;
      listeners.forEach((fn) => fn());
    }).finally(() => {
      delete loading[env];
    });
}
export const roundLoader = async ({ request }: { request: Request }) => {
  await loadRound(environmentForPath(new URL(request.url).pathname));
  return null;
};
export function useRoundLoaded(wanted = true): boolean {
  const env = useVoteEnvironment();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    setLoaded(false);
    loadRound(env).then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [wanted, env]);
  return loaded;
}
/** Capture the environment at render time, including asynchronous wallet work. */
export function useVoteApi() {
  const env = useVoteEnvironment();
  return <T>(path: string, options?: ApiOptions) =>
    options === undefined
      ? api<T>(scopeVotePath(path, env))
      : api<T>(scopeVotePath(path, env), options);
}
export function scopeVotePath(path: string, env: VoteEnvironment) {
  return env === "test"
    ? path.replace(/^\/api\/vote(?=\/|$)/, "/api/vote-test")
      .replace(/^\/api\/admin\/vote-round(?=\/|$)/, "/api/admin/vote-test-round")
    : path;
}
