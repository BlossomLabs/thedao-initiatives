/** What the moderation queue shows beside a held comment, so an admin can
 * publish or discard it without leaving the dashboard. */
import type { Deps } from "../middleware/context.ts";
import type { Comment, Initiative } from "../db/types.ts";
import { badgeHolders } from "./roles.ts";
import { screenFields } from "./ai.ts";
import { HttpError } from "../lib/errors.ts";

type Ref = { slug: string; title: string };

export interface HeldAuthor {
  address: string;
  admin: boolean;
  /** Initiatives submitted from this wallet; `here` = the one commented on. */
  proposerOf: (Ref & { status: Initiative["status"]; here: boolean })[];
  /** Confirmed donations from this wallet, per initiative. */
  backed: (Ref & { usd: number; here: boolean })[];
  /** null: the badge lookup failed. */
  badge: boolean | null;
  /** Every comment from this wallet, this one included. */
  comments: { published: number; held: number; discarded: number };
  /** The wallet's first comment or confirmed donation. */
  firstSeen: number;
}

export interface HeldContext {
  parent: Pick<Comment, "id" | "body" | "displayName" | "address" | "status"> | null;
  author: HeldAuthor | null;
}

/** Context for each held comment, keyed by comment id. */
export async function heldContext(
  deps: Pick<Deps, "db" | "chain" | "admins">,
  held: Comment[],
  initiatives: Initiative[],
): Promise<Map<string, HeldContext>> {
  const { db } = deps;
  const out = new Map<string, HeldContext>();
  if (!held.length) return out;
  const wallets = [...new Set(held.map((c) => c.address.toLowerCase()).filter(Boolean))];
  const [comments, donations, badges, admins] = await Promise.all([
    db.comments.byAuthors(wallets),
    db.donations.byDonors(wallets),
    badgeHolders(deps.chain, wallets).catch(() => null),
    deps.admins.set(),
  ]);
  const byId = new Map(initiatives.map((i) => [i.id, i]));
  const ref = (i: Initiative): Ref => ({ slug: i.slug, title: i.title });

  for (const c of held) {
    const parentRow = c.parentId ? await db.comments.get(c.parentId) : null;
    const parent = parentRow
      ? {
        id: parentRow.id,
        body: parentRow.body,
        displayName: parentRow.displayName,
        address: parentRow.address,
        status: parentRow.status,
      }
      : null;
    const low = c.address.toLowerCase();
    if (!low) {
      out.set(c.id, { parent, author: null });
      continue;
    }
    const mine = comments.get(low) ?? [];
    const gifts = donations.get(low) ?? [];
    const usd = new Map<string, number>();
    for (const d of gifts) usd.set(d.rfpId, (usd.get(d.rfpId) ?? 0) + d.amountUsd);
    const count = (s: Comment["status"]) => mine.filter((x) => x.status === s).length;
    out.set(c.id, {
      parent,
      author: {
        address: c.address,
        admin: admins.has(low),
        proposerOf: initiatives
          .filter((i) => i.proposer && i.proposer.toLowerCase() === low)
          .map((i) => ({ ...ref(i), status: i.status, here: i.id === c.rfpId })),
        backed: [...usd].flatMap(([rfpId, total]) => {
          const i = byId.get(rfpId);
          return i ? [{ ...ref(i), usd: Math.round(total), here: rfpId === c.rfpId }] : [];
        }),
        badge: badges ? badges.has(low) : null,
        comments: {
          published: count("published"),
          held: count("held"),
          discarded: count("discarded"),
        },
        firstSeen: Math.min(
          c.createdAt,
          ...mine.map((x) => x.createdAt),
          ...gifts.map((d) => d.confirmedAt ?? d.createdAt),
        ),
      },
    });
  }
  return out;
}

/** Ask the AI screen again about a held comment. The verdict and reason are
 * stored for the admin; the comment stays held whatever it says. */
export async function rescreen(
  deps: Pick<Deps, "db" | "ai" | "now" | "log">,
  id: string,
): Promise<Comment> {
  const row = await deps.db.comments.get(id);
  if (!row) throw new HttpError(404, "not found");
  if (row.status !== "held") throw new HttpError(400, "only a held comment");
  const screen = await deps.ai.screenComment(
    row.type,
    row.topic,
    row.body,
    row.displayName,
    () => deps.db.meta.aiBudgetOk(),
  );
  if (screen.error) deps.log(`AI screen failed again on held comment ${row.id}: ${screen.error}`);
  // A spam verdict says "AI said spam"; discarding stays the admin's call.
  const next = await deps.db.comments.set(row.id, screenFields(screen, deps.now()));
  return next!;
}
