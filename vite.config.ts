/// <reference types="vitest" />
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Editors save files atomically via short-lived `<file>.tmp.*` files. Deno's
// fs.watch rejects when a watcher is attached to one that has already been
// renamed away, which would kill the dev server; swallow that one rejection.
const g = globalThis as {
  Deno?: unknown;
  addEventListener?: (
    type: string,
    cb: (event: { reason?: { name?: string; stack?: string }; preventDefault: () => void }) => void,
  ) => void;
};
if (g.Deno && g.addEventListener) {
  g.addEventListener("unhandledrejection", (event) => {
    if (event.reason?.name === "NotFound" && event.reason?.stack?.includes("FsWatcher")) {
      event.preventDefault();
    }
  });
}

// The API the dev server forwards to. Only `dev:prod` (API_PROXY): its requests carry
// production's own origin, or its cross-site guard refuses every POST from localhost.
// Dev server only; the build never reads `server.proxy`.
const apiTarget = process.env.API_PROXY || "http://localhost:8000";
const api = process.env.API_PROXY
  ? {
    target: apiTarget,
    changeOrigin: true,
    headers: { origin: new URL(apiTarget).origin, referer: new URL(apiTarget).origin + "/" },
  }
  : apiTarget;

export default defineConfig({
  plugins: [tailwindcss(), !process.env.VITEST && reactRouter()],
  server: {
    port: 5173,
    strictPort: true,
    // Deno can lose native watchers when an editor replaces a file atomically,
    // leaving old transformed modules cached. Poll to keep source edits in sync.
    watch: { ignored: ["**/*.tmp.*"], usePolling: true, interval: 250 },
    // API and web share one origin in production; mirror that in dev.
    proxy: {
      "/api": api,
      "/healthz": api,
      "/vote/llms.txt": api,
      "^/initiative/[a-z0-9-]+(-PRIVATE)?\\.md$": api,
    },
  },
  resolve: {
    // `~/*` and `@shared/*` come from tsconfig.json `paths`.
    tsconfigPaths: true,
    alias: {
      "react-dom/server": fileURLToPath(
        new URL("./app/lib/react-dom-server.node.mjs", import.meta.url),
      ),
    },
  },
  build: {
    // Privy's SDK is one lazily loaded chunk (see app/lib/privy.ts) of ~540 kB
    // minified; it is already code-split, so only warn above that.
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "shared/**/*.test.ts"],
  },
});
