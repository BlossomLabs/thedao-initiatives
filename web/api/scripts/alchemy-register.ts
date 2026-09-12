/**
 * Add every approved initiative's Safe to the Alchemy Address Activity
 * webhook (one-off backfill; new Safes register themselves on confirm).
 *
 *   ADMIN_TOKEN=... deno task alchemy-register
 *   ADMIN_PRIVATE_KEY=0x... deno task alchemy-register      (logs in first)
 *
 * Env: ALCHEMY_AUTH_TOKEN, ALCHEMY_WEBHOOK_ID (Notify dashboard), API_URL
 * (default http://localhost:8000), WEB_ORIGIN.
 */
import { env, siteLockHeader, siweLogin } from "./lib.ts";
import { registerSafeAddresses } from "../services/alchemy.ts";

const apiUrl = env("API_URL", "http://localhost:8000").replace(/\/+$/, "");
const webOrigin = env("WEB_ORIGIN", "http://localhost:5173").split(",")[0].trim();
const alchemyAuthToken = env("ALCHEMY_AUTH_TOKEN");
const alchemyWebhookId = env("ALCHEMY_WEBHOOK_ID");
if (!alchemyAuthToken || !alchemyWebhookId) {
  console.error("set ALCHEMY_AUTH_TOKEN and ALCHEMY_WEBHOOK_ID (Alchemy dashboard > Webhooks)");
  Deno.exit(1);
}

let token = env("ADMIN_TOKEN");
if (!token) {
  const key = env("ADMIN_PRIVATE_KEY");
  if (!key) {
    console.error("set ADMIN_TOKEN (from `deno task login`) or ADMIN_PRIVATE_KEY");
    Deno.exit(1);
  }
  token = (await siweLogin({ apiUrl, webOrigin, privateKey: key })).token;
}

const res = await fetch(apiUrl + "/api/admin/dashboard", {
  headers: { Authorization: "Bearer " + token, Origin: webOrigin, ...siteLockHeader() },
});
if (!res.ok) {
  console.error(`dashboard failed: ${res.status} ${await res.text()}`);
  Deno.exit(1);
}
const { rows } = await res.json() as {
  rows: { initiative: { slug: string; status: string; safeAddress: string } }[];
};
const safes = rows
  .filter((r) => r.initiative.status === "approved" && r.initiative.safeAddress)
  .map((r) => r.initiative.safeAddress);
for (const r of rows) {
  if (r.initiative.status === "approved" && r.initiative.safeAddress) {
    console.error(`${r.initiative.slug}: ${r.initiative.safeAddress}`);
  }
}
if (!safes.length) {
  console.error("no approved initiative has a Safe yet; nothing to register");
  Deno.exit(0);
}
const out = await registerSafeAddresses(
  { config: { alchemyAuthToken, alchemyWebhookId }, fetch, log: console.error },
  safes,
);
if (out !== "registered") {
  console.error(out);
  Deno.exit(1);
}
console.error(`${safes.length} Safe(s) registered with webhook ${alchemyWebhookId}`);
