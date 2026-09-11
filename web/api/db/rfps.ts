import { collect, K } from "./keys.ts";
import type { Revision, RevisionSource, Rfp, RfpStatus } from "./types.ts";
import { newId } from "../lib/ids.ts";
import { slugify } from "../lib/slug.ts";
import { isStructured, sameStructured } from "../../shared/draft/mod.ts";

export type RfpInput = Partial<Omit<Rfp, "id" | "createdAt" | "revision">> & { title: string };

/** The public text fields: the only thing a revision holds. `details` is the
 * legacy markdown body; a structured row has sections/milestones/links and
 * `details: ""`. */
export type RfpText = Pick<
  Rfp,
  "title" | "summary" | "details" | "sections" | "milestones" | "links"
>;
export type RevisionOrigin = { author: string; source: RevisionSource };
/** What `revise` accepts: the legacy trio always, the structured fields
 * defaulting to empty (a legacy caller keeps writing legacy rows). */
export type RfpTextInput = Pick<RfpText, "title" | "summary" | "details"> & Partial<RfpText>;

/** The text fields of a record (row, revision or input), with defaults for
 * rows written before the structured body existed. */
export function pickText(r: Partial<RfpText>): RfpText {
  return {
    title: r.title ?? "",
    summary: r.summary ?? "",
    details: r.details ?? "",
    sections: r.sections ?? {},
    milestones: r.milestones ?? [],
    links: r.links ?? [],
  };
}

export const sameText = (a: Partial<RfpText>, b: Partial<RfpText>): boolean => {
  const x = pickText(a);
  const y = pickText(b);
  return x.title === y.title && x.summary === y.summary && x.details === y.details &&
    sameStructured(x, y);
};

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

  const revisionOf = (
    rfp: Rfp,
    n: number,
    text: RfpText,
    origin: RevisionOrigin,
    createdAt: number,
  ): Revision => ({
    rfpId: rfp.id,
    n,
    ...pickText(text),
    author: origin.author,
    source: origin.source,
    archived: false,
    createdAt,
  });

  /**
   * Insert with a unique slug (atomic check on the slug index). Revision 1 is
   * written in the same commit, so every initiative has a history from birth.
   */
  async function insert(
    fields: RfpInput,
    slug?: string,
    origin: RevisionOrigin = { author: fields.proposer ?? "", source: "submit" },
  ): Promise<Rfp> {
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
        ...pickText(fields),
        discourseUrl: fields.discourseUrl ?? "",
        goalUsd: fields.goalUsd ?? 0,
        contact: fields.contact ?? "",
        funders: fields.funders ?? "",
        proposer: fields.proposer ?? "",
        status,
        type: fields.type ?? "rfp",
        sortRank: fields.sortRank ?? null,
        safeAddress: fields.safeAddress ?? "",
        durationMonths: fields.durationMonths ?? null,
        recipientTeam: fields.recipientTeam ?? "",
        recipientUrl: fields.recipientUrl ?? "",
        topup: fields.topup ?? false,
        milestoneReviewer: fields.milestoneReviewer ?? "",
        revision: 1,
        createdAt: t,
        approvedAt: fields.approvedAt ?? (status === "approved" ? t : null),
      };
      const res = await kv.atomic()
        .check({ key: K.rfpBySlug(s), versionstamp: null })
        .set(K.rfpBySlug(s), rfp.id)
        .set(K.rfp(rfp.id), rfp)
        .set(K.revision(rfp.id, 1), revisionOf(rfp, 1, rfp, origin, t))
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

  /** Everything but the text fields, which only change through revise(). */
  const ALLOWED = new Set<keyof Rfp>([
    "discourseUrl",
    "goalUsd",
    "contact",
    "status",
    "approvedAt",
    "safeAddress",
    "sortRank",
    "type",
    "funders",
    "proposer",
    "durationMonths",
    "recipientTeam",
    "recipientUrl",
    "topup",
    "milestoneReviewer",
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
   * Replace the public text with a new revision. A no-op when nothing changed
   * (`revision: null`). A row written before revisions existed first gets its
   * current text snapshotted as revision 1, so the history is never missing
   * the version people saw.
   */
  async function revise(
    id: string,
    input: RfpTextInput,
    origin: RevisionOrigin,
  ): Promise<{ rfp: Rfp; revision: Revision | null }> {
    // Only the text fields, whatever else the caller's record carries.
    const text = pickText(input);
    if (text.details && isStructured(text)) throw new Error("structured rows carry no details");
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Rfp>(K.rfp(id));
      if (!cur.value) throw new Error("rfp not found");
      const rfp = cur.value;
      if (sameText(rfp, text)) return { rfp, revision: null };
      const legacy = !(rfp.revision > 0);
      const n = (legacy ? 1 : rfp.revision) + 1;
      const t = now();
      const revision = revisionOf(rfp, n, text, origin, t);
      const next: Rfp = { ...rfp, ...text, revision: n };
      const op = kv.atomic()
        .check(cur)
        .check({ key: K.revision(id, n), versionstamp: null })
        .set(K.rfp(id), next)
        .set(K.revision(id, n), revision);
      if (legacy) {
        op.check({ key: K.revision(id, 1), versionstamp: null }).set(
          K.revision(id, 1),
          revisionOf(rfp, 1, rfp, { author: "", source: "import" }, rfp.createdAt),
        );
      }
      const res = await op.commit();
      if (res.ok) return { rfp: next, revision };
    }
    throw new Error("update conflict");
  }

  /**
   * Create or update from a content file. Files own the words and the goal;
   * the admin panel owns the lifecycle, so an update never touches status,
   * safeAddress, or money data. Changed words become a revision.
   */
  async function upsertContent(
    slug: string,
    f: {
      title: string;
      summary: string;
      details: string;
      sections?: Rfp["sections"];
      milestones?: Rfp["milestones"];
      links?: Rfp["links"];
      goalUsd: number;
      discourseUrl: string;
      status: RfpStatus;
      sortRank: number | null;
      type: Rfp["type"];
      durationMonths: number | null;
      recipientTeam: string;
      recipientUrl: string;
      topup: boolean;
      milestoneReviewer: string;
    },
  ): Promise<"created" | "updated"> {
    const origin: RevisionOrigin = { author: "", source: "content" };
    const existing = await bySlug(slug);
    if (existing) {
      const patch: Partial<Rfp> = {
        goalUsd: f.goalUsd,
        discourseUrl: f.discourseUrl,
        type: f.type,
        durationMonths: f.durationMonths,
        recipientTeam: f.recipientTeam,
        recipientUrl: f.recipientUrl,
        topup: f.topup,
        milestoneReviewer: f.milestoneReviewer,
      };
      if (f.sortRank !== null) patch.sortRank = f.sortRank;
      await update(existing.id, patch);
      await revise(existing.id, f, origin);
      return "updated";
    }
    await insert({ ...f }, slug, origin);
    return "created";
  }

  return { get, bySlug, bySafe, insert, list, update, revise, upsertContent };
}
