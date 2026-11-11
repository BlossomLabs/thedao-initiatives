import { bytesToHex } from "viem";
import type { RoundView } from "~/hooks/use-vote";
import { encodeBallot, type Tier } from "../../../shared/vote/ballot";

const micro = (usd: number) => String(Math.round(usd * 1_000_000));

/** Dev only (`/vote/ballot?mock=spent`): badge `n` coming back to change its ballot after
 * S settled and spent part of its share. 40 badges vote; S funded the first two
 * initiatives (badge `n` paid for both) and left the third unfunded; A is in its first window. */
export function spentRound(slugs: string[], poolMicro: string, n: number): RoundView {
  const voters = 40;
  const share = BigInt(poolMicro) / BigInt(voters);
  const usd = Number(share / 1_000_000n);
  const ballot: Partial<Record<string, Tier>> = {
    [slugs[0]]: "S",
    [slugs[1]]: "S",
    [slugs[2]]: "S",
    [slugs[3]]: "A",
    [slugs[4]]: "A",
    [slugs[5]]: "B",
  };
  const now = Math.floor(Date.now() / 1000);
  const paid = { [slugs[0]]: micro(usd * 0.28), [slugs[1]]: micro(usd * 0.14) };
  return {
    registrationClosesAt: now - 3 * 3600,
    closed: false,
    share: share.toString(),
    tiers: [
      {
        tier: "S",
        status: "settled",
        at: now - 2 * 3600,
        forced: false,
        funded: [slugs[0], slugs[1]],
        awards: { [slugs[0]]: micro(usd * 0.28 * 31), [slugs[1]]: micro(usd * 0.14 * 22) },
        paid: { [String(n)]: paid },
      },
      {
        tier: "A",
        status: "settling",
        window: 1,
        windowEndsAt: now + 50 * 60,
        latestEndAt: now + 95 * 60,
        quiet: true,
        funded: [slugs[3]],
      },
      { tier: "B", status: "waiting", startsAt: now + 6 * 3600 },
    ],
    accepted: { [String(n)]: bytesToHex(encodeBallot(slugs, ballot)) },
    rejected: [],
    live: {
      funded: [slugs[3]],
      awards: { [slugs[3]]: micro(usd * 9) },
      tiers: { [slugs[3]]: "A" },
    },
  };
}
