import { collect, K } from "./keys.ts";
import type { Rfp, RfpStatus } from "./types.ts";
import { newId } from "../lib/ids.ts";
import { slugify } from "../lib/slug.ts";

export type RfpInput = Partial<Omit<Rfp, "id" | "createdAt">> & { title: string };

export function rfpsRepo(kv: Deno.Kv, now: () => number) {
  const get = async (id: string): Promise<Rfp | null> => (await kv.get<Rfp>(K.rfp(id))).value;

  const bySlug = async (slug: string): Promise<Rfp | null> => {
    const id = (await kv.get<string>(K.rfpBySlug(slug))).value;
    return id ? get(id) : null;
  };

  const bySafe = async (addr: string): Promise<Rfp | null> => {
    const id = (await kv.get<string>(K.rfpBySafe(addr))).value;
    return id ? get(id) : null;
  };

  /** Insert with a unique slug (atomic check on the slug index). */
  async function insert(fields: RfpInput, slug?: string): Promise<Rfp> {
    const base = slug ?? slugify(fields.title);
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = attempt === 0
        ? base
        : attempt < 4
        ? `${base}-${attempt + 1}`
        : `${base}-${1000 + Math.floor(Math.random() * 9000)}`;
      if (slug && attempt > 0) throw new Error(`slug already exists: ${slug}`);
      const t = now();
      const status: RfpStatus = fields.status ?? "pending";
      const rfp: Rfp = {
        id: newId(),
        slug: s,
        title: fields.title,
        summary: fields.summary ?? "",
        details: fields.details ?? "",
        discourseUrl: fields.discourseUrl ?? "",
        goalUsd: fields.goalUsd ?? 0,
        contact: fields.contact ?? "",
        funders: fields.funders ?? "",
        status,
        type: fields.type ?? "rfp",
        sortRank: fields.sortRank ?? null,
        safeAddress: fields.safeAddress ?? "",
        createdAt: t,
        approvedAt: fields.approvedAt ?? (status === "approved" ? t : null),
      };
      const res = await kv.atomic()
        .check({ key: K.rfpBySlug(s), versionstamp: null })
        .set(K.rfpBySlug(s), rfp.id)
        .set(K.rfp(rfp.id), rfp)
        .commit();
      if (res.ok) return rfp;
    }
    throw new Error("could not allocate a unique slug");
  }

  const list = async (statuses: RfpStatus[]): Promise<Rfp[]> => {
    const all = await collect(kv.list<Rfp>({ prefix: ["rfp"] }));
    return all.filter((r) => statuses.includes(r.status))
      .sort((a, b) => b.createdAt - a.createdAt);
  };

  const ALLOWED = new Set<keyof Rfp>([
    "title",
    "summary",
    "details",
    "discourseUrl",
    "goalUsd",
    "contact",
    "status",
    "approvedAt",
    "safeAddress",
    "sortRank",
    "type",
    "funders",
  ]);

  /** Patch allowed fields; keeps the Safe index in step. */
  async function update(id: string, patch: Partial<Rfp>): Promise<Rfp> {
    for (const k of Object.keys(patch)) {
      if (!ALLOWED.has(k as keyof Rfp)) throw new Error(`field not allowed: ${k}`);
    }
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Rfp>(K.rfp(id));
      if (!cur.value) throw new Error("rfp not found");
      const next: Rfp = { ...cur.value, ...patch };
      const op = kv.atomic().check(cur).set(K.rfp(id), next);
      if (
        patch.safeAddress !== undefined && patch.safeAddress !== cur.value.safeAddress
      ) {
        if (cur.value.safeAddress) op.delete(K.rfpBySafe(cur.value.safeAddress));
        if (patch.safeAddress) {
          op.check({ key: K.rfpBySafe(patch.safeAddress), versionstamp: null })
            .set(K.rfpBySafe(patch.safeAddress), id);
        }
      }
      const res = await op.commit();
      if (res.ok) return next;
      if (patch.safeAddress && (await kv.get(K.rfpBySafe(patch.safeAddress))).value) {
        throw new Error("safe address already assigned");
      }
    }
    throw new Error("update conflict");
  }

  /**
   * Create or update from a content file. Files own the words and the goal;
   * the admin panel owns the lifecycle, so an update never touches status,
   * safeAddress, or money data.
   */
  async function upsertContent(
    slug: string,
    f: {
      title: string;
      summary: string;
      details: string;
      goalUsd: number;
      discourseUrl: string;
      status: RfpStatus;
      sortRank: number | null;
      type: Rfp["type"];
    },
  ): Promise<"created" | "updated"> {
    const existing = await bySlug(slug);
    if (existing) {
      const patch: Partial<Rfp> = {
        title: f.title,
        summary: f.summary,
        details: f.details,
        goalUsd: f.goalUsd,
        discourseUrl: f.discourseUrl,
        type: f.type,
      };
      if (f.sortRank !== null) patch.sortRank = f.sortRank;
      await update(existing.id, patch);
      return "updated";
    }
    await insert({ ...f }, slug);
    return "created";
  }

  return { get, bySlug, bySafe, insert, list, update, upsertContent };
}
