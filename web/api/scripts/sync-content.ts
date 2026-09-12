/**
 * Push content/rfps/*.md to a running API (push-based content sync), and seed
 * the donation terms from content/donation-terms.md when the API has none yet.
 * Later terms versions are published on purpose:
 *
 *   ADMIN_TOKEN=... deno task sync-content
 *   ADMIN_PRIVATE_KEY=0x... deno task sync-content      (logs in first)
 *   deno task sync-content --publish-terms [--material] (publish the file as a new version)
 *
 * Env: API_URL (default http://localhost:8000), WEB_ORIGIN, CONTENT_DIR
 * (default content/rfps at the repo root), TERMS_FILE.
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

// Logos first: content/rfps/logos/<name> is pinned once (same bytes = same CID),
// so a backers line can name the file.
const logosDir = env("CONTENT_LOGOS_DIR") ||
  new URL("../../../content/rfps/logos/", import.meta.url).pathname;
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

// Donation terms: the API keeps every published version (content hash +
// effective date). The first run seeds it from content/donation-terms.md;
// after that a new version is published on purpose with --publish-terms
// (add --material when the change is material, which shows the 30-day notice).
const args = new Set(Deno.args);
const termsPath = env("TERMS_FILE") ||
  new URL("../../../content/donation-terms.md", import.meta.url).pathname;
const have = await fetch(apiUrl + "/api/terms", { headers: { Origin: webOrigin } });
if (have.status === 404 || args.has("--publish-terms")) {
  const raw = await Deno.readTextFile(termsPath);
  const m = /^version:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*\r?\n/i.exec(raw);
  if (!m) {
    console.error(
      "donation-terms.md: first line must be `version: YYYY-MM-DD` (the effective date)",
    );
    Deno.exit(1);
  }
  const pub = await fetch(apiUrl + "/api/admin/terms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      Origin: webOrigin,
    },
    body: JSON.stringify({
      text: raw.slice(m[0].length).trim(),
      effectiveDate: m[1],
      material: args.has("--material"),
    }),
  });
  const out = await pub.json();
  if (!pub.ok) {
    console.error("terms publish failed:", pub.status, out);
    Deno.exit(1);
  }
  console.error(
    `terms: ${out.outcome} version ${
      out.version.id.slice(0, 12)
    } effective ${out.version.effectiveDate}${out.version.material ? " (material change)" : ""}`,
  );
} else {
  console.error(
    `terms: API already has a published version (${have.status}); use --publish-terms to publish the file`,
  );
}
if (body.errors?.length) Deno.exit(2);
