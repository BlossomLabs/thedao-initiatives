import { parseTermsFile, type TermsVersion } from "../../shared/terms.ts";

let versions: Promise<readonly TermsVersion[]> | undefined;

/** Read the deployed, version-controlled documents; a missing catalog fails closed. */
export function publishedDonationTerms(): Promise<readonly TermsVersion[]> {
  return versions ??= (async () => {
    const dir = new URL("../../content/donation-terms/", import.meta.url);
    const out: TermsVersion[] = [];
    for await (const file of Deno.readDir(dir)) {
      if (file.isFile && file.name.endsWith(".md")) {
        out.push(parseTermsFile(await Deno.readTextFile(new URL(file.name, dir)), file.name));
      }
    }
    if (!out.length) throw new Error("No published donation terms");
    return out;
  })().catch((error) => {
    versions = undefined;
    throw error;
  });
}
