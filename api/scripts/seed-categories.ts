/**
 * Tag initiatives from api/scripts/categories-seed.json (slug -> 1 to 3
 * categories, primary first), each as a revision by the admin. Idempotent: a row that
 * already has exactly those categories is left alone, so a rerun changes
 * nothing. Logs seed slugs missing from the site, and every approved, pending
 * or archived row that is still untagged afterwards.
 *
 *   ADMIN_PRIVATE_KEY=0x... API_URL=https://initiatives.thedao.fund deno task seed-categories
 *   ADMIN_TOKEN=... deno task seed-categories -- --dry-run
 */
import { env, siweLogin } from "./lib.ts";
import { webOriginsFrom } from "../config.ts";
import { readCategories } from "../../shared/categories.ts";

const apiUrl = env("API_URL", "http://localhost:8000").replace(/\/+$/, "");
const webOrigin = webOriginsFrom(Deno.env.toObject())[0];
const dry = Deno.args.includes("--dry-run");

const seed: Record<string, string[]> = JSON.parse(
  await Deno.readTextFile(new URL("./categories-seed.json", import.meta.url)),
);
for (const [slug, cats] of Object.entries(seed)) {
  const [, err] = readCategories(cats);
  if (err) throw new Error(`seed ${slug}: ${err}`);
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
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer " + token,
  Origin: webOrigin,
};

type Row = { initiative: { id: string; slug: string; status: string; categories?: string[] } };
const dash = await fetch(apiUrl + "/api/admin/dashboard", { headers });
if (!dash.ok) throw new Error(`dashboard ${dash.status}: ${await dash.text()}`);
const rows = (await dash.json() as { rows: Row[] }).rows.map((r) => r.initiative);
const bySlug = new Map(rows.map((r) => [r.slug, r]));

let changed = 0, same = 0;
const missing: string[] = [];
for (const [slug, cats] of Object.entries(seed)) {
  const row = bySlug.get(slug);
  if (!row) {
    missing.push(slug);
    continue;
  }
  if ((row.categories ?? []).join() === cats.join()) {
    same++;
    continue;
  }
  console.error(`${dry ? "would tag" : "tag"} ${slug}: ${cats.join(", ")}`);
  if (!dry) {
    const res = await fetch(apiUrl + `/api/initiatives/${encodeURIComponent(slug)}/revisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ categories: cats, initiativeId: row.id }),
    });
    if (!res.ok) throw new Error(`${slug}: ${res.status} ${await res.text()}`);
    row.categories = cats;
  }
  changed++;
}
const untagged = rows.filter((r) =>
  ["approved", "pending", "archived"].includes(r.status) && !(r.categories ?? []).length &&
  !(dry && seed[r.slug])
);
console.error(`${changed} ${dry ? "to tag" : "tagged"}, ${same} already right`);
if (missing.length) console.error(`seed slugs not on the site: ${missing.join(", ")}`);
if (untagged.length) {
  console.error(
    `still untagged: ${untagged.map((r) => `${r.slug} (${r.status})`).join(", ")}`,
  );
  Deno.exit(2);
}
