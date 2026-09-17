import { rfpsRepo } from "./rfps.ts";
import { logosRepo } from "./logos.ts";
import { revisionsRepo } from "./revisions.ts";
import { pledgesRepo } from "./pledges.ts";
import { donationsRepo } from "./donations.ts";
import { commentsRepo } from "./comments.ts";
import { profilesRepo } from "./profiles.ts";
import { sessionsRepo } from "./sessions.ts";
import { rateLimiter, type RateLimiterOptions } from "./ratelimit.ts";
import { metaRepo } from "./meta.ts";
import { termsRepo } from "./terms.ts";

export type * from "./types.ts";

export function createDb(
  kv: Deno.Kv,
  now: () => number = () => Date.now() / 1000,
  opts: RateLimiterOptions = {},
) {
  const pledges = pledgesRepo(kv, now);
  const donations = donationsRepo(kv, now);
  return {
    kv,
    now,
    rfps: rfpsRepo(kv, now),
    logos: logosRepo(kv, now),
    revisions: revisionsRepo(kv),
    pledges,
    donations,
    comments: commentsRepo(kv, now),
    profiles: profilesRepo(kv, now),
    sessions: sessionsRepo(kv, now),
    meta: metaRepo(kv, now),
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
