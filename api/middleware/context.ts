import type { Context } from "hono";
import type { Db, Session } from "../db/mod.ts";
import type { Chain } from "../chain/mod.ts";
import type { Config } from "../config.ts";
import type { Ai } from "../services/ai.ts";
import type { Ens } from "../services/ens.ts";
import type { Pinata } from "../services/pinata.ts";
import type { resolvePublicIps } from "../lib/validate.ts";
import type { Funding } from "../services/funding.ts";
import type { Admins } from "../services/admins.ts";
import type { Maintenance } from "../services/maintenance.ts";
import type { VoteRound } from "../services/vote-chain.ts";

export interface Deps {
  db: Db;
  chain: Chain;
  config: Config;
  fetch: typeof fetch;
  now: () => number;
  ai: Ai;
  ens: Ens;
  pinata: Pinata;
  log: (msg: string) => void;
  /** DNS -> public IPs check for user-supplied hosts (injectable for tests). */
  resolve?: typeof resolvePublicIps;
  /** Live funding from Safe balances (services/funding.ts). */
  funding: Funding;
  /** The admin list: ADMIN_ADDRESSES plus dashboard additions (services/admins.ts). */
  admins: Admins;
  /** The write freeze admins toggle from the dashboard (services/maintenance.ts). */
  maintenance: Maintenance;
  /** The vote round; absent until a contract is deployed (routes answer 503). */
  vote?: VoteRound;
  /** Handed work a request starts but doesn't wait for (the vote's gap to the next
   * tier). Absent, it just runs; tests collect it so they can wait for it. */
  background?: (work: Promise<unknown>) => void;
}

export type Vars = {
  Variables: {
    user: Session | null;
    token: string;
    ip: string | null;
    /** Set by the maintenance gate on a refused write, so the audit does not
     * count it as a server failure. */
    maintenance?: boolean;
  };
};

export type Ctx = Context<Vars>;
