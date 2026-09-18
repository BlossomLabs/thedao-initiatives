import { K } from "./keys.ts";

/** A pinned content logo: content/initiatives/logos/<name> as the sync last saw it. */
export interface ContentLogo {
  name: string;
  cid: string;
  sha256: string;
  at: number;
}

export function logosRepo(kv: Deno.Kv, now: () => number) {
  async function get(name: string): Promise<ContentLogo | null> {
    return (await kv.get<ContentLogo>(K.contentLogo(name))).value;
  }
  async function set(name: string, cid: string, sha256: string): Promise<ContentLogo> {
    const rec = { name, cid, sha256, at: now() };
    await kv.set(K.contentLogo(name), rec);
    return rec;
  }
  return { get, set };
}
