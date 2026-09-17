import { mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import base from "../../../vite.config.ts";

const config = mergeConfig(base, {
  resolve: { alias: { "~": fileURLToPath(new URL("../../../app", import.meta.url)) } },
});
config.test = {
  ...config.test,
  include: ["docs/security/retest-2026-09-17/revision-cache.repro.test.tsx"],
};
export default config;
