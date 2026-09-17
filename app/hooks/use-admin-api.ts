import { useSession } from "~/context/session";
import { api, type ApiOptions } from "~/lib/api";
import { withReauthentication } from "~/lib/reauthenticate";

export function useAdminApi() {
  const { signIn } = useSession();
  return <T>(path: string, options?: ApiOptions): Promise<T> =>
    withReauthentication(() => api<T>(path, options), signIn);
}
