import { fileURLToPath } from "node:url";
import base from "../../../../vite.config.ts";
export default {
  ...base,
  resolve: { ...base.resolve, alias: { ...base.resolve?.alias, "~": fileURLToPath(new URL("../../../../app", import.meta.url)) } },
  test: { ...base.test, include: ["docs/security/asvs-2026-09-15/evidence/client-cache.test.tsx"] },
};
