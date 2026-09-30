/**
 * What the board needs from an initiative's pledge and donation rows, kept as
 * one small value per initiative (#46) instead of two lists per card on every
 * build. It is a rebuildable copy, never the truth: every pledge or donation
 * write bumps the initiative's card version in the same atomic operation, the
 * summary carries the version it was built from, and a reader rebuilds from the
 * rows whenever the two differ. A bug can cost a rebuild, never a wrong number.
 * The lookup may be an eventual read; the rows a copy is built from never are.
 */
import { K, type ReadOptions } from "./keys.ts";
import type { Pledge } from "./types.ts";
import type { pledgesRepo } from "./pledges.ts";
import type { donationsRepo } from "./donations.ts";

export interface CardSummary {
  version: string;
  /** Active pledges (pledged or received), largest first, as pledges.list() orders them. */
  pledges: Pick<Pledge, "id" | "company" | "amountUsd" | "status" | "url" | "logoCid">[];
  /** Confirmed donation rows, their USD total, and distinct donor addresses. */
  donations: number;
  donatedUsd: number;
  donors: number;
}

/** getMany takes ten keys: five initiatives (version and summary each) per trip. */
const PER_TRIP = 5;

export function cardsRepo(
  kv: Deno.Kv,
  read: ReadOptions,
  pledges: ReturnType<typeof pledgesRepo>,
  donations: ReturnType<typeof donationsRepo>,
) {
  async function build(rfpId: string, version: string): Promise<CardSummary> {
    // Strong reads: the version was read first, so a write that lands after it
    // bumps the version and retires this copy; a replica behind that write must
    // not hand us rows the version says are already there.
    const [ps, ds] = await Promise.all([
      pledges.list(rfpId, false, true),
      donations.list(rfpId, true, true),
    ]);
    const summary: CardSummary = {
      version,
      pledges: ps.map(({ id, company, amountUsd, status, url, logoCid }) => ({
        id,
        company,
        amountUsd,
        status,
        url,
        logoCid,
      })),
      donations: ds.length,
      donatedUsd: Math.round(ds.reduce((s, d) => s + d.amountUsd, 0) * 100) / 100,
      donors: new Set(ds.map((d) => d.donor.toLowerCase()).filter(Boolean)).size,
    };
    // No check needed: a write in between bumped the version, so this copy is skipped.
    await kv.set(K.cardSummary(rfpId), summary);
    return summary;
  }

  /** One summary per id, in the order asked; misses are built from the rows and stored. */
  async function summaries(ids: string[]): Promise<CardSummary[]> {
    const groups: string[][] = [];
    for (let i = 0; i < ids.length; i += PER_TRIP) groups.push(ids.slice(i, i + PER_TRIP));
    const entries = (await Promise.all(
      groups.map((g) =>
        kv.getMany(g.flatMap((id) => [K.cardVersion(id), K.cardSummary(id)]), read)
      ),
    )).flat();
    return Promise.all(ids.map((id, i) => {
      const version = (entries[2 * i].value as string | null) ?? "";
      const summary = entries[2 * i + 1].value as CardSummary | null;
      return summary && summary.version === version ? summary : build(id, version);
    }));
  }

  const summary = async (rfpId: string): Promise<CardSummary> => (await summaries([rfpId]))[0];

  return { summary, summaries };
}
