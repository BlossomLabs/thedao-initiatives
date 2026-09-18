/** Security events contain only explicitly selected metadata, never request payloads. */
import type { Context, MiddlewareHandler } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";

const WALLET = /^0x[0-9a-f]{40}$/i;

const ACTIONS = {
  "auth.verify": "authentication",
  "auth.cookie": "session",
  "session.logout": "session",
  "session.logout_all": "session",
  "session.revoke": "session",
  "session.admin_revoke": "session",
  "session.admin_revoke_all": "session",
  "admin.add": "administration",
  "admin.remove": "administration",
  "admin.mutation": "administration",
  "initiative.edit": "administration",
  "initiative.revise": "administration",
  "initiative.status": "administration",
  "initiative.bulk": "administration",
  "revision.visibility": "administration",
  "pledge.add": "administration",
  "pledge.edit": "administration",
  "pledge.remove": "administration",
  "donation.recheck": "administration",
  "donation.sync": "administration",
  "safe.confirm": "administration",
  "comment.moderate": "administration",
  "comment.bulk": "administration",
  "logo.upload": "administration",
  "content.sync": "administration",
  "content.item": "administration",
  "maintenance.enter": "administration",
  "maintenance.exit": "administration",
  "backup.export": "administration",
  "backup.restore": "administration",
  "audit.test": "system",
  "authorization.denied": "authorization",
  "validation.rejected": "validation",
  "abuse.limited": "abuse",
  "request.failed": "system",
} as const;
export type AuditAction = keyof typeof ACTIONS;
type TargetKind =
  | "application"
  | "wallet"
  | "session"
  | "initiative"
  | "revision"
  | "pledge"
  | "donation"
  | "comment"
  | "logo"
  | "content"
  | "audit";
type Outcome = "attempt" | "success" | "failure" | "denied" | "partial" | "pending";
const DETAILS = [
  "approve",
  "reject",
  "archive",
  "unarchive",
  "publish",
  "discard",
  "review",
  "feature",
  "feature-front",
  "unfeature",
  "unreport",
  "reauthenticate",
  "login",
  "merge",
  "replace",
] as const;
type Detail = typeof DETAILS[number];

export interface AuditInput {
  action: AuditAction;
  targetKind?: TargetKind;
  /** Raw identifiers are hashed, except valid public wallet addresses. */
  target?: string;
  outcome: Outcome;
  status?: number;
  detail?: string;
}

export interface AuditEvent {
  schema: 1;
  id: string;
  at: string;
  requestId: string;
  category: typeof ACTIONS[AuditAction];
  action: AuditAction;
  outcome: Outcome;
  actor: string | null;
  target: { kind: TargetKind; id?: string };
  status?: number;
  detail?: Detail;
}

type Descriptor = Omit<AuditInput, "outcome">;
type State = { requestId: string; descriptor?: Descriptor; actor?: string; outcome?: Outcome };
const states = new WeakMap<Context<Vars>, State>();

// Only fixed route patterns are classified. Neither arbitrary URLs nor query
// strings, response bodies, forwarding headers or submitted data are logged.
const ROUTES: [string, RegExp, AuditAction, TargetKind, number?][] = [
  ["POST", /^\/api\/auth\/verify$/, "auth.verify", "wallet"],
  ["POST", /^\/api\/auth\/cookie$/, "auth.cookie", "session"],
  ["POST", /^\/api\/auth\/logout$/, "session.logout", "session"],
  ["POST", /^\/api\/auth\/logout-all$/, "session.logout_all", "wallet"],
  ["DELETE", /^\/api\/auth\/sessions\/([^/]+)$/, "session.revoke", "session", 1],
  ["POST", /^\/api\/admin\/sessions\/revoke$/, "session.admin_revoke", "wallet"],
  ["POST", /^\/api\/admin\/sessions\/revoke-all$/, "session.admin_revoke_all", "application"],
  ["POST", /^\/api\/admin\/admins$/, "admin.add", "wallet"],
  ["DELETE", /^\/api\/admin\/admins\/([^/]+)$/, "admin.remove", "wallet", 1],
  ["PATCH", /^\/api\/admin\/initiatives\/([^/]+)$/, "initiative.edit", "initiative", 1],
  ["POST", /^\/api\/admin\/initiatives\/bulk$/, "initiative.bulk", "initiative"],
  ["POST", /^\/api\/admin\/initiatives\/([^/]+)\/status$/, "initiative.status", "initiative", 1],
  [
    "POST",
    /^\/api\/admin\/initiatives\/([^/]+)\/revisions\/([^/]+)$/,
    "revision.visibility",
    "revision",
    1,
  ],
  ["POST", /^\/api\/admin\/initiatives\/([^/]+)\/pledges$/, "pledge.add", "initiative", 1],
  ["PATCH", /^\/api\/admin\/initiatives\/[^/]+\/pledges\/([^/]+)$/, "pledge.edit", "pledge", 1],
  ["DELETE", /^\/api\/admin\/initiatives\/[^/]+\/pledges\/([^/]+)$/, "pledge.remove", "pledge", 1],
  [
    "POST",
    /^\/api\/admin\/initiatives\/([^/]+)\/donations\/recheck$/,
    "donation.recheck",
    "initiative",
    1,
  ],
  [
    "POST",
    /^\/api\/admin\/initiatives\/([^/]+)\/sync-donations$/,
    "donation.sync",
    "initiative",
    1,
  ],
  ["POST", /^\/api\/admin\/initiatives\/([^/]+)\/safe-confirm$/, "safe.confirm", "initiative", 1],
  ["POST", /^\/api\/admin\/comments\/bulk$/, "comment.bulk", "comment"],
  ["POST", /^\/api\/admin\/comments\/([^/]+)\/[^/]+$/, "comment.moderate", "comment", 1],
  ["POST", /^\/api\/admin\/logos$/, "logo.upload", "logo"],
  ["POST", /^\/api\/admin\/sync-content$/, "content.sync", "content"],
  ["POST", /^\/api\/admin\/maintenance\/enter$/, "maintenance.enter", "application"],
  ["POST", /^\/api\/admin\/maintenance\/exit$/, "maintenance.exit", "application"],
  ["GET", /^\/api\/admin\/backup$/, "backup.export", "application"],
  ["POST", /^\/api\/admin\/restore$/, "backup.restore", "application"],
  ["POST", /^\/api\/admin\/audit\/test$/, "audit.test", "audit"],
];

function classify(c: Context<Vars>): Descriptor | undefined {
  for (const [method, re, action, targetKind, group] of ROUTES) {
    if (c.req.method !== method) continue;
    const match = re.exec(c.req.path);
    if (match) return { action, targetKind, target: group ? match[group] : undefined };
  }
  if (c.req.path.startsWith("/api/admin/") && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    return { action: "admin.mutation", targetKind: "application" };
  }
}

/** Set verified metadata; callers must not pass messages, signatures or tokens. */
export function auditContext(
  c: Context<Vars>,
  update: { actor?: string; target?: string; detail?: string; outcome?: Outcome },
): void {
  const state = states.get(c);
  if (!state) return;
  if (update.actor && WALLET.test(update.actor)) state.actor = update.actor.toLowerCase();
  if (state.descriptor) {
    if (update.target !== undefined) state.descriptor.target = update.target;
    if (update.detail !== undefined) state.descriptor.detail = update.detail;
  }
  if (update.outcome) state.outcome = update.outcome;
}

/** Emit one JSON line through the console logger for OpenTelemetry collection. */
export function recordAudit(deps: Deps, c: Context<Vars>, input: AuditInput): void {
  const state = states.get(c);
  if (!state) throw new Error("audit middleware is required");
  const time = deps.now();
  const actor = state.actor ?? c.var.user?.address;
  const kind = input.targetKind ?? "application";
  const selfWallet = input.action === "auth.verify" || input.action === "session.logout_all";
  const target = input.target ||
    (kind === "wallet" && selfWallet ? actor : kind === "session" ? c.var.user?.id : undefined);
  const event: AuditEvent = {
    schema: 1,
    id: crypto.randomUUID(),
    at: new Date(time * 1000).toISOString(),
    requestId: state.requestId,
    category: ACTIONS[input.action],
    action: input.action,
    outcome: input.outcome,
    actor: actor && WALLET.test(actor) ? actor.toLowerCase() : null,
    target: {
      kind,
      ...(target
        ? {
          id: kind === "wallet" && WALLET.test(target) ? target.toLowerCase() : sha256Hex(target),
        }
        : {}),
    },
    ...(Number.isInteger(input.status) ? { status: input.status } : {}),
    ...(DETAILS.includes(input.detail as Detail) ? { detail: input.detail as Detail } : {}),
  };
  try {
    deps.log(JSON.stringify({ securityAudit: true, ...event }));
  } catch { /* Log delivery must not change the operation's result. */ }
}

/** Per-item intent and outcome for operations that can partially succeed. */
export async function auditedItem<T>(
  deps: Deps,
  c: Context<Vars>,
  input: Descriptor,
  run: () => Promise<T>,
): Promise<T> {
  recordAudit(deps, c, { ...input, outcome: "attempt" });
  let result: T;
  try {
    result = await run();
  } catch (error) {
    recordAudit(deps, c, {
      ...input,
      outcome: "failure",
      status: error instanceof HttpError ? error.status : 500,
    });
    throw error;
  }
  recordAudit(deps, c, { ...input, outcome: "success" });
  return result;
}

/** Installed before all guards, so early denials are observable as well. */
export function securityAudit(deps: Deps): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const state: State = { requestId: crypto.randomUUID(), descriptor: classify(c) };
    states.set(c, state);
    c.header("X-Request-ID", state.requestId);
    await next();
    const status = c.res.status;
    const failure: AuditAction | undefined = status === 401 || status === 403
      ? "authorization.denied"
      : status === 429
      ? "abuse.limited"
      : [400, 413, 415, 422].includes(status)
      ? "validation.rejected"
      : status >= 500 && !c.var.maintenance // a paused write is not a server fault
      ? "request.failed"
      : undefined;
    if (state.descriptor) {
      recordAudit(deps, c, {
        ...state.descriptor,
        status,
        outcome: status >= 400 ? "failure" : state.outcome ?? "success",
      });
    }
    if (failure) {
      recordAudit(deps, c, {
        ...state.descriptor,
        action: failure,
        status,
        outcome: failure === "authorization.denied" ? "denied" : "failure",
      });
    }
  };
}

/** Installed after session loading, but before any sensitive route mutation. */
export function auditIntent(deps: Deps): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const state = states.get(c);
    // Administrators can also edit through the proposer-facing endpoints.
    if (state && !state.descriptor && c.var.user?.isAdmin) {
      const edit = /^\/api\/initiatives\/([^/]+)$/.exec(c.req.path);
      const revision = /^\/api\/initiatives\/([^/]+)\/revisions$/.exec(c.req.path);
      if (c.req.method === "PATCH" && edit) {
        state.descriptor = { action: "initiative.edit", targetKind: "initiative", target: edit[1] };
      } else if (c.req.method === "POST" && revision) {
        state.descriptor = {
          action: "initiative.revise",
          targetKind: "initiative",
          target: revision[1],
        };
      }
    }
    if (state?.descriptor && c.req.method !== "GET") {
      recordAudit(deps, c, { ...state.descriptor, outcome: "attempt" });
    }
    await next();
  };
}
