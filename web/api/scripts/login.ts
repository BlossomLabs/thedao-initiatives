/**
 * Dev helper: sign in with a local private key and print the bearer token.
 *
 *   ADMIN_PRIVATE_KEY=0x... deno task login
 *
 * Env: API_URL (default http://localhost:8000), WEB_ORIGIN or VITE_SITE_URL
 * (the origin to sign in as, resolved like the API does; default
 * http://localhost:5173). The key's address must be in ADMIN_ADDRESSES for an
 * admin session.
 */
import { env, siweLogin } from "./lib.ts";
import { webOriginsFrom } from "../config.ts";

const privateKey = env("ADMIN_PRIVATE_KEY");
if (!privateKey) {
  console.error("set ADMIN_PRIVATE_KEY (a 32-byte hex private key of a dev wallet)");
  Deno.exit(1);
}
const out = await siweLogin({
  apiUrl: env("API_URL", "http://localhost:8000").replace(/\/+$/, ""),
  webOrigin: webOriginsFrom(Deno.env.toObject())[0],
  privateKey,
});
console.error(`signed in as ${out.address}${out.isAdmin ? " (admin)" : ""}`);
console.log(out.token);
