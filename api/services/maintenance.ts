/**
 * Maintenance mode: an admin-set flag in KV that pauses every write on the
 * site while reads keep working, so the data can be backed up, restored or
 * moved without anything changing underneath. Sign-in and the admin controls
 * that end maintenance stay open. Each isolate re-reads the flag every few
 * seconds, so other instances follow a toggle within that window.
 */
import type { MiddlewareHandler } from "hono";
import type { Db } from "../db/mod.ts";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";

export const MAINTENANCE_META_KEY = "maintenance";
export const MAINTENANCE_CACHE_SECS = 3;
export const MAINTENANCE_MESSAGE =
  "The site is in maintenance mode; changes are paused. Please try again in a few minutes.";

export interface MaintenanceState {
  on: boolean;
  /** The admin who last changed it. */
  by: string;
  at: number;
  /** Shown to visitors in the banner; keep it public. */
  note: string;
}

const OFF: MaintenanceState = { on: false, by: "", at: 0, note: "" };

/** Writes that stay open: sign-in/out and session management, the toggle
 * itself, backup and restore, and the two reads the API takes as POST. */
export const maintenanceAllows = (path: string): boolean =>
  path.startsWith("/api/auth/") ||
  path === "/api/admin/maintenance" ||
  path.startsWith("/api/admin/maintenance/") ||
  path === "/api/admin/backup" ||
  path === "/api/admin/restore" ||
  path === "/api/comments/mine" ||
  path === "/api/ai-search";

export function createMaintenance(db: Db, now: () => number) {
  let cache: { state: MaintenanceState; at: number } | null = null;

  /** Straight from KV: the toggle and the restore precondition use this. */
  const fresh = async (): Promise<MaintenanceState> =>
    (await db.meta.get<MaintenanceState>(MAINTENANCE_META_KEY)) ?? OFF;

  /** The per-isolate snapshot every gated request reads. */
  const state = async (): Promise<MaintenanceState> => {
    if (cache && now() - cache.at < MAINTENANCE_CACHE_SECS) return cache.state;
    const s = await fresh();
    cache = { state: s, at: now() };
    return s;
  };

  const on = async (): Promise<boolean> => (await state()).on;

  const write = async (s: MaintenanceState): Promise<MaintenanceState> => {
    await db.meta.set(MAINTENANCE_META_KEY, s);
    cache = null;
    return s;
  };

  const enter = (by: string, note: string) => write({ on: true, by, at: now(), note });
  const exit = async (by?: string) =>
    write({ on: false, by: by ?? (await fresh()).by, at: now(), note: "" });

  return { state, fresh, on, enter, exit };
}

export type Maintenance = ReturnType<typeof createMaintenance>;

/** Refuses writes while maintenance is on. Sits after the session loader so
 * the refused attempt is audited with its actor. */
export function maintenanceGate(deps: Deps): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const m = c.req.method;
    if (m === "GET" || m === "HEAD" || m === "OPTIONS" || maintenanceAllows(c.req.path)) {
      return await next();
    }
    if (await deps.maintenance.on()) {
      c.set("maintenance", true);
      throw new HttpError(503, MAINTENANCE_MESSAGE, { maintenance: true });
    }
    await next();
  };
}
