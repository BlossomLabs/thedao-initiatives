/**
 * Push content/rfps/*.md to a running API (push-based content sync). The
 * donation terms are not content the API takes: the site bundles them at
 * build time (app/data/terms.ts).
 *
 *   ADMIN_TOKEN=... deno task sync-content
 *   ADMIN_PRIVATE_KEY=0x... deno task sync-content      (logs in first)
 *
 * Env: API_URL (default http://localhost:8000), WEB_ORIGIN, CONTENT_DIR
 * (default content/rfps at the repo root).
 */
import { env, siweLogin } from "./lib.ts";

const apiUrl = env("API_URL", "http://localhost:8000").replace(/\/+$/, "");
const webOrigin = env("WEB_ORIGIN", "http://localhost:5173").split(",")[0].trim();
const dir = env("CONTENT_DIR") ||
  new URL("../../../content/rfps/", import.meta.url).pathname;

let token = env("ADMIN_TOKEN");
if (!token) {
  const key = env("ADMIN_PRIVATE_KEY");
  if (!key) {
    console.error("set ADMIN_TOKEN (from `deno task login`) or ADMIN_PRIVATE_KEY");
    Deno.exit(1);
  }
  token = (await siweLogin({ apiUrl, webOrigin, privateKey: key })).token;
}

// Logos first: content/logos/<name> is pinned once (same bytes = same CID),
// so a backers line can name the file.
const logosDir = env("CONTENT_LOGOS_DIR") ||
  new URL("../../../content/logos/", import.meta.url).pathname;
let logos = 0;
try {
  for await (const e of Deno.readDir(logosDir)) {
    if (!e.isFile || !/\.(png|jpe?g|webp)$/i.test(e.name)) continue;
    const bytes = await Deno.readFile(`${logosDir.replace(/\/+$/, "")}/${e.name}`);
    const form = new FormData();
    form.set("name", e.name.toLowerCase());
    form.set("image", new Blob([bytes]), e.name);
    const up = await fetch(apiUrl + "/api/admin/logos", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, Origin: webOrigin },
      body: form,
    });
    const out = await up.json();
    if (!up.ok) {
      console.error(`logo ${e.name} failed:`, up.status, out);
      Deno.exit(1);
    }
    console.error(`logo ${e.name}: ${out.reused ? "already pinned" : "pinned"} ${out.cid}`);
    logos++;
  }
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}
console.error(`${logos} logo(s) from ${logosDir}`);

const files: { name: string; text: string }[] = [];
for await (const e of Deno.readDir(dir)) {
  if (e.isFile && e.name.endsWith(".md") && e.name !== "README.md") {
    files.push({
      name: e.name,
      text: await Deno.readTextFile(`${dir.replace(/\/+$/, "")}/${e.name}`),
    });
  }
}
console.error(`syncing ${files.length} file(s) from ${dir} to ${apiUrl}`);
const res = await fetch(apiUrl + "/api/admin/sync-content", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
    Origin: webOrigin,
  },
  body: JSON.stringify({ files }),
});
const body = await res.json();
if (!res.ok) {
  console.error("sync failed:", res.status, body);
  Deno.exit(1);
}
console.log(JSON.stringify(body, null, 2));
if (body.errors?.length) Deno.exit(2);
