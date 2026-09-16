import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
const origin = "https://initiatives.thedao.fund";
const account = privateKeyToAccount(generatePrivateKey());
// Private key and session credentials stay in memory; evidence excludes them.
const records: Record<string, unknown>[] = [];
const cookies: string[] = [];
async function req(path: string, init: RequestInit = {}) {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  return { response, data };
}
async function verify(existingCookie = "") {
  const { data: nonceData } = await req("/api/auth/nonce");
  const message = createSiweMessage({ address: account.address, chainId: 1, domain: "initiatives.thedao.fund", uri: origin, version: "1", nonce: nonceData.nonce, issuedAt: new Date(), statement: "Sign in for the owner-authorized ASVS security assessment." });
  const signature = await account.signMessage({ message });
  const json = { message, signature, cookie: true };
  const result = await req("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(existingCookie ? { Cookie: existingCookie } : {}) }, body: JSON.stringify(json) });
  const setCookie = result.response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  if (cookie.includes("=")) cookies.push(cookie);
  records.push({ check: "SIWE cookie sign-in", status: result.response.status, identity: result.data, cookieName: cookie.split("=")[0], attributes: setCookie.split(";").slice(1).join(";"), tokenInBody: "token" in result.data });
  if (result.response.status !== 200) throw new Error("Sign-in did not succeed");
  return { cookie, json };
}
async function check(label: string, path: string, cookie: string, method = "GET", customOrigin = origin) {
  const { response, data } = await req(path, { method, headers: { Cookie: cookie, Origin: customOrigin } });
  records.push({ check: label, path, status: response.status, response: data });
}
try {
  const first = await verify();
  await check("Authenticated identity", "/api/auth/me", first.cookie);
  for (const path of ["/api/admin/admins", "/api/admin/leads", "/api/admin/dashboard", "/api/initiatives/mine"]) await check("Ordinary-user authorization", path, first.cookie);
  await check("Foreign Origin rejected before logout", "/api/auth/logout", first.cookie, "POST", "https://asvs.invalid");
  await check("Null Origin rejected before logout", "/api/auth/logout", first.cookie, "POST", "null");
  const replay = await req("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(first.json) });
  records.push({ check: "Signed nonce replay", status: replay.response.status, response: replay.data });
  const second = await verify(first.cookie);
  await check("Previous session after re-authentication", "/api/auth/me", first.cookie);
  await check("Logout new session", "/api/auth/logout", second.cookie, "POST");
  await check("Logged-out session rejected", "/api/auth/me", second.cookie);
  await check("Logout all sessions", "/api/auth/logout-all", first.cookie, "POST");
  await check("Original session rejected after logout-all", "/api/auth/me", first.cookie);
} finally {
  for (const cookie of cookies) {
    try { await req("/api/auth/logout-all", { method: "POST", headers: { Cookie: cookie, Origin: origin } }); } catch { /* evidence preserved below */ }
  }
  await Deno.writeTextFile("/tmp/asvs-siwe-evidence.json", JSON.stringify({ at: new Date().toISOString(), address: account.address, privateKeyPersisted: false, records }, null, 2));
  console.log(JSON.stringify(records, null, 2));
}
