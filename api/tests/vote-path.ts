import type { Deps } from "../middleware/context.ts";
/** Existing single-round fixtures explicitly address their round's environment. */
export const voteRequestPath = (deps: Deps, path: string) =>
  deps.vote?.manifest.kind === "test"
    ? path.replace("/api/vote/", "/api/vote-test/").replace(
      "/api/admin/vote-round",
      "/api/admin/vote-test-round",
    )
    : path;
