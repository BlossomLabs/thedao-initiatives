import type { Context } from "hono";
import type { Db, Session } from "../db/mod.ts";
import type { Chain } from "../chain/mod.ts";
import type { Config } from "../config.ts";
import type { Ai } from "../services/ai.ts";
import type { Ens } from "../services/ens.ts";
import type { Pinata } from "../services/pinata.ts";
import type { resolvePublicIps } from "../lib/validate.ts";
import type { SafeSyncQueue } from "../services/sync-queue.ts";

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
  /** Event-driven Safe syncs (webhook receivers); absent = triggers are dropped. */
  syncQueue?: SafeSyncQueue;
}

export type Vars = {
  Variables: {
    user: Session | null;
    token: string;
    ip: string;
  };
};

export type Ctx = Context<Vars>;
