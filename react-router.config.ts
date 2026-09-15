import type { Config } from "@react-router/dev/config";

export default {
  ssr: false,
  // Fixed pages get a static shell (SEO + fast first paint). Initiative and
  // admin pages load from the API client-side; /admin is the dashboard, so it
  // gets the SPA fallback's dashboard skeleton rather than a prerendered
  // signed-out gate.
  prerender: ["/", "/submit", "/submit/thanks", "/donation-terms"],
} satisfies Config;
