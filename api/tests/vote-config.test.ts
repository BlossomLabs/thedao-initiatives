import { assertEquals } from "@std/assert";
import { loadConfig } from "../config.ts";

const KEY = `0x${"1".repeat(64)}`;
const OLD = `0x${"2".repeat(64)}`;

Deno.test("the vote relayer key: VOTE_RELAYER_KEY, else the old DEVCON_RELAYER_KEY", () => {
  assertEquals(loadConfig({ VOTE_RELAYER_KEY: KEY }).voteRelayerKey, KEY);
  // A deploy that still has the secret under its old name keeps relaying.
  assertEquals(loadConfig({ DEVCON_RELAYER_KEY: OLD }).voteRelayerKey, OLD);
  // The new name wins when both are set.
  assertEquals(loadConfig({ VOTE_RELAYER_KEY: KEY, DEVCON_RELAYER_KEY: OLD }).voteRelayerKey, KEY);
  assertEquals(loadConfig({}).voteRelayerKey, "");
});
