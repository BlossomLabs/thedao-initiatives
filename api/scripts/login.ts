/**
 * Dev helper: sign in with a local private key and print the bearer token.
 *
 *   ADMIN_PRIVATE_KEY=0x... deno task login
 *
 * Env: API_URL (default http://localhost:8000), WEB_ORIGIN (default
 * http://localhost:5173; must be one the API allows). The key's address must
 * be in ADMIN_ADDRESSES for an admin session.
 */
import { env, siweLogin } from "./lib.ts";

const privateKey = env("ADMIN_PRIVATE_KEY");
if (!privateKey) {
  console.error("set ADMIN_PRIVATE_KEY (a 32-byte hex private key of a dev wallet)");
  Deno.exit(1);
}
const out = await siweLogin({
  apiUrl: env("API_URL", "http://localhost:8000").replace(/\/+$/, ""),
  webOrigin: env("WEB_ORIGIN", "http://localhost:5173").split(",")[0].trim(),
  privateKey,
});
console.error(`signed in as ${out.address}${out.isAdmin ? " (admin)" : ""}`);
console.log(out.token);
