import { initiativesRepo } from "./initiatives.ts";
import { logosRepo } from "./logos.ts";
import { revisionsRepo } from "./revisions.ts";
import { pledgesRepo } from "./pledges.ts";
import { donationsRepo } from "./donations.ts";
import { commentsRepo } from "./comments.ts";
import { profilesRepo } from "./profiles.ts";
import { watchlistsRepo } from "./watchlists.ts";
import { sessionsRepo } from "./sessions.ts";
import { rateLimiter, type RateLimiterOptions } from "./ratelimit.ts";
import type { ReadOptions } from "./keys.ts";
import { metaRepo } from "./meta.ts";
import { termsRepo } from "./terms.ts";
import { cardsRepo } from "./cards.ts";
import { snapshotsRepo } from "./snapshots.ts";

export type * from "./types.ts";

export interface DbOptions extends RateLimiterOptions {
  /** Serve the public reads (rows, lists, snapshots) from the nearest KV
   * replica. Every write keeps strong reads for the entries it checks. */
  eventualReads?: boolean;
}

export function createDb(
  kv: Deno.Kv,
  now: () => number = () => Date.now() / 1000,
  opts: DbOptions = {},
) {
  const read: ReadOptions = opts.eventualReads ? { consistency: "eventual" } : undefined;
  const pledges = pledgesRepo(kv, now, read);
  const donations = donationsRepo(kv, now, read);
  return {
    kv,
    now,
    /** The consistency for public reads outside the repos (funding snapshots). */
    read,
    initiatives: initiativesRepo(kv, now, read),
    logos: logosRepo(kv, now),
    revisions: revisionsRepo(kv, read),
    pledges,
    donations,
    cards: cardsRepo(kv, read, pledges, donations),
    comments: commentsRepo(kv, now, read),
    profiles: profilesRepo(kv, now),
    watchlists: watchlistsRepo(kv, now),
    sessions: sessionsRepo(kv, now),
    meta: metaRepo(kv, now, read),
    snapshots: snapshotsRepo(kv, now, read),
    terms: termsRepo(kv, now),
    rateLimit: rateLimiter(kv, now, opts),
    /** Ledger-only totals (pledges + confirmed donation rows). The pages use
     * services/funding.ts, which prices the Safe's balances instead. */
    async fundingSummary(rfpId: string) {
      const [pledged, donated] = await Promise.all([
        pledges.totalActive(rfpId),
        donations.confirmedTotal(rfpId),
      ]);
      const cents = (n: number) => Math.round(n * 100) / 100;
      return {
        pledged: cents(pledged),
        donated: cents(donated),
        total: cents(pledged + donated),
      };
    },
  };
}

export type Db = ReturnType<typeof createDb>;
