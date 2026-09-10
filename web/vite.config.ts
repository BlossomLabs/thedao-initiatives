/// <reference types="vitest" />
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

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

export default defineConfig({
  plugins: [tailwindcss(), !process.env.VITEST && reactRouter(), tsconfigPaths()],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/*.tmp.*"] },
    // app/data/terms.ts imports ../content/donation-terms.md from outside web/.
    fs: { allow: [".", fileURLToPath(new URL("../content", import.meta.url))] },
    // API and web share one origin in production; mirror that in dev.
    proxy: {
      "/api": process.env.API_PROXY || "http://localhost:8000",
      "/healthz": process.env.API_PROXY || "http://localhost:8000",
    },
  },
  resolve: {
    alias: {
      "react-dom/server": fileURLToPath(new URL("./app/lib/react-dom-server.node.mjs", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
  },
});
