import { collect, K, type ReadOptions } from "./keys.ts";
import type { Initiative, InitiativeStatus, Revision, RevisionSource } from "./types.ts";
import { newId } from "../lib/ids.ts";
import { slugify } from "../lib/slug.ts";
import { isStructured, sameStructured } from "../../shared/draft/mod.ts";

export type InitiativeInput = Partial<Omit<Initiative, "id" | "createdAt" | "revision">> & {
  title: string;
};

/** The public text fields: the only thing a revision holds. `details` is the
 * legacy markdown body; a structured row has sections/milestones/links and
 * `details: ""`. */
export type InitiativeText = Pick<
  Initiative,
  "title" | "summary" | "details" | "sections" | "milestones" | "links"
>;
export type RevisionOrigin = { author: string; source: RevisionSource };
/** What `revise` accepts: the legacy trio always, the structured fields
 * defaulting to empty (a legacy caller keeps writing legacy rows). */
export type InitiativeTextInput =
  & Pick<InitiativeText, "title" | "summary" | "details">
  & Partial<InitiativeText>;

/** The text fields of a record (row, revision or input), with defaults for
 * rows written before the structured body existed. */
export function pickText(r: Partial<InitiativeText>): InitiativeText {
  return {
    title: r.title ?? "",
    summary: r.summary ?? "",
    details: r.details ?? "",
    sections: r.sections ?? {},
    milestones: r.milestones ?? [],
    links: r.links ?? [],
  };
}

export const sameText = (a: Partial<InitiativeText>, b: Partial<InitiativeText>): boolean => {
  const x = pickText(a);
  const y = pickText(b);
  return x.title === y.title && x.summary === y.summary && x.details === y.details &&
    sameStructured(x, y);
};

/** What `revise` accepts: the text, and the categories when they change with it. */
export type RevisionInput = InitiativeTextInput & { categories?: string[] };

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** The fields a board card, the funding summary and the ledger status read from a row. */
export const CARD_FIELDS = [
  "id",
  "slug",
  "title",
  "summary",
  "goalUsd",
  "status",
  "type",
  "sortRank",
  "safeAddress",
  "paidOutUsd",
  "categories",
  "recipientTeam",
  "createdAt",
  "approvedAt",
] as const;
export type CardRow = Pick<Initiative, typeof CARD_FIELDS[number]>;
export function cardRow(r: Initiative): CardRow {
  const out: Partial<CardRow> = {};
  for (const k of CARD_FIELDS) if (r[k] !== undefined) (out as Record<string, unknown>)[k] = r[k];
  return out as CardRow;
}

/** Under meta: the status index (#47) is complete at this shape. Missing (a database from
 * before it, or one restored from a backup) means the next cards() read rebuilds it. */
export const STATUS_INDEX_MARK = "rfp_by_status";
const STATUS_INDEX_VERSION = 2; // 2: cards carry recipientTeam

export function initiativesRepo(kv: Deno.Kv, now: () => number, read: ReadOptions = undefined) {
  /** Every row write also writes its card under its status, off the old status when it moved. */
  const indexRow = (op: Deno.AtomicOperation, before: Initiative | null, next: Initiative) => {
    if (before && before.status !== next.status) {
      op.delete(K.initiativeByStatus(before.status, before.id));
    }
    return op.set(K.initiativeByStatus(next.status, next.id), cardRow(next));
  };
  // Public reads; every writer re-reads what it checks with strong consistency.
  const get = async (id: string): Promise<Initiative | null> =>
    (await kv.get<Initiative>(K.initiative(id), read)).value;

  const bySlug = async (slug: string): Promise<Initiative | null> => {
    const id = (await kv.get<string>(K.initiativeBySlug(slug), read)).value;
    return id ? get(id) : null;
  };

  const isReusedSlug = async (slug: string): Promise<boolean> =>
    (await kv.get<boolean>(K.reusedInitiativeSlug(slug))).value === true;

  /** Source filenames retain their original target even when a public URL is reused.
   * Bind older rows lazily, checking the URL index against concurrent reclamation. */
  async function bySourceSlug(slug: string): Promise<Initiative | null> {
    for (let retry = 0; retry < 8; retry++) {
      const source = await kv.get<string>(K.initiativeBySourceSlug(slug));
      if (source.value) {
        const row = await get(source.value);
        if (!row) throw new Error(`missing source proposal: ${slug}`);
        return row;
      }
      const index = await kv.get<string>(K.initiativeBySlug(slug));
      if (!index.value) return null;
      const row = await kv.get<Initiative>(K.initiative(index.value));
      if (!row.value) throw new Error(`missing proposal: ${slug}`);
      const res = await kv.atomic().check(source, index, row)
        .set(K.initiativeBySourceSlug(slug), row.value.id).commit();
      if (res.ok) return row.value;
    }
    throw new Error("source binding conflict");
  }

  /**
   * The initiative a Safe belongs to. Rows imported from the SQLite MVP
   * predate the by-Safe index, so a miss falls back to a scan and writes the
   * index for next time.
   */
  const bySafe = async (addr: string): Promise<Initiative | null> => {
    const id = (await kv.get<string>(K.initiativeBySafe(addr))).value;
    if (id) return get(id);
    const low = addr.toLowerCase();
    const all = await collect(kv.list<Initiative>({ prefix: ["rfp"] }));
    const hit = all.find((r) => r.safeAddress.toLowerCase() === low) ?? null;
    if (hit) await kv.set(K.initiativeBySafe(hit.safeAddress), hit.id);
    return hit;
  };

  const revisionOf = (
    initiative: Initiative,
    n: number,
    text: InitiativeText,
    categories: string[],
    origin: RevisionOrigin,
    createdAt: number,
  ): Revision => ({
    rfpId: initiative.id,
    n,
    ...pickText(text),
    categories,
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
    fields: InitiativeInput,
    slug?: string,
    origin: RevisionOrigin = { author: fields.proposer ?? "", source: "submit" },
    options: { reclaimArchivedSlug?: boolean; createdAt?: number } = {},
  ): Promise<Initiative> {
    const base = slug ?? slugify(fields.title);
    const id = newId();
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = attempt === 0
        ? base
        : attempt < 4
        ? `${base}-${attempt + 1}`
        : `${base}-${1000 + Math.floor(Math.random() * 9000)}`;
      if (slug && attempt > 0) throw new Error(`slug already exists: ${slug}`);
      const t = options.createdAt ?? now();
      const status: InitiativeStatus = fields.status ?? "pending";
      const initiative: Initiative = {
        id,
        slug: s,
        safeDeploymentKey: origin.source === "import" ? s : `rfp:${id}`,
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
        paidOutUsd: fields.paidOutUsd ?? 0,
        durationMonths: fields.durationMonths ?? null,
        recipientTeam: fields.recipientTeam ?? "",
        recipientUrl: fields.recipientUrl ?? "",
        topup: fields.topup ?? false,
        milestoneReviewer: fields.milestoneReviewer ?? "",
        categories: fields.categories ?? [],
        revision: 1,
        createdAt: t,
        approvedAt: fields.approvedAt ?? (status === "approved" ? t : null),
      };
      for (let retry = 0; retry < 8; retry++) {
        const index = await kv.get<string>(K.initiativeBySlug(s));
        const owner = index.value ? await kv.get<Initiative>(K.initiative(index.value)) : null;
        if (index.value && !owner?.value) throw new Error(`missing proposal: ${s}`);
        const reclaim = slug === undefined && attempt === 0 && options.reclaimArchivedSlug &&
          owner?.value?.status === "archived" && owner.value.archiveSlug !== s;
        if (index.value && !reclaim) break;

        const op = kv.atomic().check(index)
          .check({ key: K.initiative(id), versionstamp: null })
          .check({ key: K.revision(id, 1), versionstamp: null })
          .set(K.initiativeBySlug(s), id)
          .set(K.initiative(id), initiative)
          .set(
            K.revision(id, 1),
            revisionOf(initiative, 1, initiative, initiative.categories ?? [], origin, t),
          );
        indexRow(op, null, initiative);
        if (reclaim && owner?.value) {
          const old = owner.value;
          const archiveBase = `${s}-archived-${old.id.toLowerCase()}`;
          let archiveSlug = old.archiveSlug ?? archiveBase;
          let suffix = 2;
          let archiveIndex = await kv.get<string>(K.initiativeBySlug(archiveSlug));
          while (archiveIndex.value !== null && archiveIndex.value !== old.id) {
            archiveSlug = `${archiveBase}-${suffix++}`;
            archiveIndex = await kv.get<string>(K.initiativeBySlug(archiveSlug));
          }
          const moved: Initiative = {
            ...old,
            slug: archiveSlug,
            archiveSlug,
            safeDeploymentKey: old.safeDeploymentKey ?? old.slug,
          };
          op.check(owner)
            .check(archiveIndex)
            .set(K.initiativeBySlug(archiveSlug), old.id)
            .set(K.initiative(old.id), moved)
            .set(K.reusedInitiativeSlug(s), true);
          indexRow(op, old, moved);
          // Pin even legacy filenames before handing their public URL away.
          const source = await kv.get<string>(K.initiativeBySourceSlug(s));
          op.check(source);
          if (!source.value) op.set(K.initiativeBySourceSlug(s), old.id);
        }
        if (origin.source === "content" || origin.source === "import") {
          const source = await kv.get<string>(K.initiativeBySourceSlug(s));
          if (source.value) throw new Error(`source already exists: ${s}`);
          op.check(source).set(K.initiativeBySourceSlug(s), id);
        }
        if (initiative.safeAddress) {
          if ((await kv.get(K.initiativeBySafe(initiative.safeAddress))).value) {
            throw new Error(`Safe already assigned: ${initiative.safeAddress}`);
          }
          op.check({ key: K.initiativeBySafe(initiative.safeAddress), versionstamp: null })
            .set(K.initiativeBySafe(initiative.safeAddress), id);
        }
        if ((await op.commit()).ok) return initiative;
        if (retry === 7) throw new Error("proposal insertion conflict");
      }
    }
    throw new Error("could not allocate a unique slug");
  }

  const list = async (statuses: InitiativeStatus[]): Promise<Initiative[]> => {
    const all = await collect(kv.list<Initiative>({ prefix: ["rfp"] }, read));
    return all.filter((r) => statuses.includes(r.status))
      .sort((a, b) => b.createdAt - a.createdAt);
  };

  /**
   * The cards of every row in one status, newest first, from the index: one
   * list of small values instead of every full row of every status (#47). The
   * mark under meta says the index is complete; without it (a database from
   * before the index, or just restored) the index is rebuilt from a full scan
   * first, keeping any entry a concurrent writer put there meanwhile.
   */
  async function cards(status: InitiativeStatus): Promise<CardRow[]> {
    const [mark, rows] = await Promise.all([
      kv.get<number>(K.meta(STATUS_INDEX_MARK), read),
      collect(kv.list<CardRow>({ prefix: K.initiativesByStatus(status) }, read)),
    ]);
    const found = mark.value === STATUS_INDEX_VERSION
      ? rows
      : (await rebuildIndex()).filter((r) => r.status === status);
    return found.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function rebuildIndex(): Promise<CardRow[]> {
    // Out with entries a restore may have left under a status the row no longer has.
    let op = kv.atomic();
    let n = 0;
    for await (const e of kv.list({ prefix: ["rfp_by_status"] })) {
      op.delete(e.key);
      if (++n % 500 === 0) {
        await op.commit();
        op = kv.atomic();
      }
    }
    if (n % 500) await op.commit();
    const all = (await collect(kv.list<Initiative>({ prefix: ["rfp"] }))).map(cardRow);
    for (let i = 0; i < all.length; i += 100) {
      const batch = all.slice(i, i + 100);
      const entry = (r: CardRow, o: Deno.AtomicOperation) =>
        o.check({ key: K.initiativeByStatus(r.status, r.id), versionstamp: null })
          .set(K.initiativeByStatus(r.status, r.id), r);
      const o = kv.atomic();
      for (const r of batch) entry(r, o);
      if (!(await o.commit()).ok) {
        // A writer got there first for some row: its entry is newer, keep it.
        for (const r of batch) await entry(r, kv.atomic()).commit();
      }
    }
    await kv.set(K.meta(STATUS_INDEX_MARK), STATUS_INDEX_VERSION);
    return all;
  }

  /** Restore with a freshly allocated title slug; archive URLs remain aliases.
   * Unlike submission, restoring never displaces another archived proposal. */
  async function unarchive(id: string): Promise<Initiative> {
    for (let retry = 0; retry < 8; retry++) {
      const cur = await kv.get<Initiative>(K.initiative(id));
      if (!cur.value) throw new Error("rfp not found");
      const old = cur.value;
      // Approving a pending row or repeating the action keeps its URL. Read
      // status inside this transaction so a concurrent archive gets retried.
      const base = old.status === "archived" ? slugify(old.title) : old.slug;
      let slug = base;
      let suffix = 2;
      let index = await kv.get<string>(K.initiativeBySlug(slug));
      while (index.value !== null && index.value !== id) {
        slug = `${base}-${suffix++}`;
        index = await kv.get<string>(K.initiativeBySlug(slug));
      }
      const next: Initiative = {
        ...old,
        slug,
        status: "approved",
        approvedAt: old.approvedAt ?? now(),
        safeDeploymentKey: old.safeDeploymentKey ?? old.slug,
      };
      const op = kv.atomic().check(cur, index).set(K.initiative(id), next)
        .set(K.initiativeBySlug(slug), id);
      indexRow(op, old, next);
      if (slug !== old.slug) {
        const source = await kv.get<string>(K.initiativeBySourceSlug(old.slug));
        op.check(source);
        if (!source.value) op.set(K.initiativeBySourceSlug(old.slug), id);
        if (old.slug !== old.archiveSlug) {
          const previous = await kv.get<string>(K.initiativeBySlug(old.slug));
          if (previous.value !== id) continue;
          op.check(previous).delete(K.initiativeBySlug(old.slug))
            .set(K.reusedInitiativeSlug(old.slug), true);
        }
      }
      if ((await op.commit()).ok) return next;
    }
    throw new Error("unarchive conflict");
  }

  /** Everything but the text fields and the categories, which only change
   * through revise() and retag(). */
  const ALLOWED = new Set<keyof Initiative>([
    "discourseUrl",
    "goalUsd",
    "contact",
    "status",
    "approvedAt",
    "safeAddress",
    "paidOutUsd",
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
  async function update(id: string, patch: Partial<Initiative>): Promise<Initiative> {
    for (const k of Object.keys(patch)) {
      if (!ALLOWED.has(k as keyof Initiative)) throw new Error(`field not allowed: ${k}`);
    }
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Initiative>(K.initiative(id));
      if (!cur.value) throw new Error("rfp not found");
      const next: Initiative = { ...cur.value, ...patch };
      const op = kv.atomic().check(cur).set(K.initiative(id), next);
      indexRow(op, cur.value, next);
      if (
        patch.safeAddress !== undefined && patch.safeAddress !== cur.value.safeAddress
      ) {
        if (cur.value.safeAddress) op.delete(K.initiativeBySafe(cur.value.safeAddress));
        if (patch.safeAddress) {
          op.check({ key: K.initiativeBySafe(patch.safeAddress), versionstamp: null })
            .set(K.initiativeBySafe(patch.safeAddress), id);
        }
      }
      const res = await op.commit();
      if (res.ok) return next;
      if (patch.safeAddress && (await kv.get(K.initiativeBySafe(patch.safeAddress))).value) {
        throw new Error("safe address already assigned");
      }
    }
    throw new Error("update conflict");
  }

  /**
   * Write a new revision: the text and the categories `pick` returns for the
   * row as it stands. A no-op when neither changed (`revision: null`). A row
   * written before revisions existed first gets its current text snapshotted
   * as revision 1, so the history is never missing the version people saw.
   */
  async function writeRevision(
    id: string,
    pick: (current: Initiative) => { text: InitiativeText; categories: string[] },
    origin: RevisionOrigin,
  ): Promise<{ initiative: Initiative; revision: Revision | null }> {
    for (let i = 0; i < 5; i++) {
      const cur = await kv.get<Initiative>(K.initiative(id));
      if (!cur.value) throw new Error("rfp not found");
      const initiative = cur.value;
      const before = initiative.categories ?? [];
      const { text, categories } = pick(initiative);
      if (sameText(initiative, text) && sameList(before, categories)) {
        return { initiative, revision: null };
      }
      const legacy = !(initiative.revision > 0);
      const n = (legacy ? 1 : initiative.revision) + 1;
      const t = now();
      const revision = revisionOf(initiative, n, text, categories, origin, t);
      const next: Initiative = { ...initiative, ...text, categories, revision: n };
      const op = kv.atomic()
        .check(cur)
        .check({ key: K.revision(id, n), versionstamp: null })
        .set(K.initiative(id), next)
        .set(K.revision(id, n), revision);
      indexRow(op, initiative, next);
      if (legacy) {
        op.check({ key: K.revision(id, 1), versionstamp: null }).set(
          K.revision(id, 1),
          revisionOf(
            initiative,
            1,
            initiative,
            before,
            { author: "", source: "import" },
            initiative.createdAt,
          ),
        );
      }
      const res = await op.commit();
      if (res.ok) return { initiative: next, revision };
    }
    throw new Error("update conflict");
  }

  /** Replace the public text, and the categories when the input names them. */
  async function revise(id: string, input: RevisionInput, origin: RevisionOrigin) {
    // Only the text fields, whatever else the caller's record carries.
    const text = pickText(input);
    if (text.details && isStructured(text)) throw new Error("structured rows carry no details");
    return await writeRevision(
      id,
      (current) => ({ text, categories: input.categories ?? current.categories ?? [] }),
      origin,
    );
  }

  /** Replace the categories alone: a revision whose text is the row's own. */
  function retag(id: string, categories: string[], origin: RevisionOrigin) {
    return writeRevision(id, (current) => ({ text: pickText(current), categories }), origin);
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
      sections?: Initiative["sections"];
      milestones?: Initiative["milestones"];
      links?: Initiative["links"];
      goalUsd: number;
      discourseUrl: string;
      status: InitiativeStatus;
      sortRank: number | null;
      type: Initiative["type"];
      durationMonths: number | null;
      recipientTeam: string;
      recipientUrl: string;
      topup: boolean;
      milestoneReviewer: string;
    },
  ): Promise<{ action: "created" | "updated"; id: string }> {
    const origin: RevisionOrigin = { author: "", source: "content" };
    const existing = await bySourceSlug(slug);
    if (existing) {
      const patch: Partial<Initiative> = {
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
      return { action: "updated", id: existing.id };
    }
    const row = await insert({ ...f }, slug, origin);
    return { action: "created", id: row.id };
  }

  return {
    get,
    bySlug,
    bySourceSlug,
    isReusedSlug,
    bySafe,
    insert,
    list,
    cards,
    update,
    unarchive,
    revise,
    retag,
    upsertContent,
  };
}
