import type { VoteManifest } from "./manifest.ts";

export type VoteEnvironment = "production" | "test";
export const voteEnvironment = (m: Pick<VoteManifest, "kind">): VoteEnvironment =>
  m.kind === "real" ? "production" : "test";
export const voteBase = (env: VoteEnvironment) => env === "test" ? "/vote-test" : "/vote";
export const voteLabel = (env: VoteEnvironment) => env === "test" ? "Test vote" : "Vote";
/** A file name's prefix: "test-" for the test vote, nothing for the vote. */
export const voteFilePrefix = (env: VoteEnvironment) => env === "test" ? "test-" : "";
export const environmentForPath = (path: string): VoteEnvironment =>
  /^\/(?:admin\/)?vote-test(?:\/|$)/.test(path) ? "test" : "production";
