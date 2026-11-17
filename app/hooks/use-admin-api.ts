import { scopeVotePath, useVoteEnvironment } from "~/lib/vote-round";
import { useSession } from "~/context/session";
import { api, type ApiOptions } from "~/lib/api";
import { withReauthentication } from "~/lib/reauthenticate";

export function useAdminApi() {
  const env = useVoteEnvironment();
  const { signIn } = useSession();
  return <T>(path: string, options?: ApiOptions): Promise<T> =>
    withReauthentication(() => api<T>(scopeVotePath(path, env), options), signIn);
}
