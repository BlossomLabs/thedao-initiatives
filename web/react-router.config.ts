import type { Config } from "@react-router/dev/config";

export default {
  ssr: false,
  // Fixed pages get a static shell (SEO + fast first paint). Initiative and
  // admin pages load from the API client-side.
  prerender: ["/", "/submit", "/submit/thanks", "/donation-terms", "/admin"],
} satisfies Config;
