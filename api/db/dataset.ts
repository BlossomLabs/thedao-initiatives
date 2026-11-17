import { CLAIM_TTL_SECS } from "./comments.ts";
import type { Comment } from "./types.ts";
/** Versioned application records. A large administrative change is staged off-line
 * and published with one head CAS. Sessions, quotas and leases never roll back.
 * Request scopes pin a generation; writes from an obsolete scope fail closed. */
import { AsyncLocalStorage } from "node:async_hooks";
import { HttpError } from "../lib/errors.ts";

const ROOT = "__dataset";
const HEAD = [ROOT, "head"] as const;
const REVISION = [ROOT, "revision"] as const;
const MAX_SCOPE_MS = 10 * 60_000;
const RETAIN_MS = 60 * 60_000;
const DURABLE = new Set([
  "checkbox_acceptance",
  "comment",
  "comment_ref",
  "content_logo",
  "donation",
  "donation_association",
  "donation_by_tx",
  "meta",
  "nft_rating_v1",
  "nft_review_v1",
  "nick",
  "pending_association",
  "pledge",
  "profile",
  "rating",
  "reused_rfp_slug",
  "review",
  "revision",
  "rfp",
  "rfp_by_safe",
  "rfp_by_slug",
  "rfp_by_source_slug",
  "safe_balances",
  "safe_sync",
  "vote",
  "watchlist",
  "terms_accept",
  "terms_verified",
  "terms_accept_history",
  "rfp_by_status",
  "card_version",
  "card_summary",
  "claim",
  "snapshot",
]);

export function transientVoteKey(input: Deno.KvKey): boolean {
  if (input[0] !== "vote") return false;
  if (input[1] === "relayer" && (input.length === 2 || input.length === 4)) return true;
  if (input[1] === "production" || input[1] === "test") input = [input[0], ...input.slice(2)];
  const key = typeof input[1] === "number" ? [input[0], ...input.slice(2)] : input;
  if (typeof key[1] !== "string" || !/^0x[0-9a-f]{40}$/i.test(key[1])) return false;
  return (key.length === 5 && (key[2] === "pending" || key[2] === "pledge-outcome")) ||
    ((key.length === 3 || key[2] === "corrections1") &&
      (key.at(-1) === "round" || key.at(-1) === "ballots"));
}
export function datasetKey(key: Deno.KvKey): boolean {
  return DURABLE.has(String(key[0])) &&
    !(key[0] === "meta" && key[1] === "maintenance") && !transientVoteKey(key);
}
const disposable = (key: Deno.KvKey) =>
  key[0] === "claim" || key[0] === "snapshot" || key[0] === "card_summary";
interface Scope {
  head: Deno.KvEntryMaybe<string>;
  started: number;
  staging?: boolean;
  outcomes?: ((committed: boolean) => void)[];
}
interface Controller {
  raw: Deno.Kv;
  scopes: AsyncLocalStorage<Scope>;
  scope(): Promise<Scope>;
}
const controllers = new WeakMap<Deno.Kv, Controller>();
const conflict = () => new HttpError(409, "The dataset changed. Please retry the operation.");
function alive(s: Scope) {
  if (Date.now() - s.started > MAX_SCOPE_MS) throw conflict();
}
const physical = (key: Deno.KvKey, scope: Scope): Deno.KvKey =>
  datasetKey(key) && scope.head.value ? [ROOT, "data", scope.head.value, ...key] : key;

/** Deno KV's documented ordering: bytes, UTF-8 strings, numbers, bigints, booleans. */
function compare(a: Deno.KvKey, b: Deno.KvKey): number {
  const type = (v: Deno.KvKeyPart) =>
    v instanceof Uint8Array
      ? 0
      : ({ string: 1, number: 2, bigint: 3, boolean: 4 })[typeof v as "string"];
  const bytes = (x: Uint8Array, y: Uint8Array) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  };
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = a[i], y = b[i];
    if (typeof x === "symbol" || typeof y === "symbol") throw new Error("Unsupported key symbol");
    const t = type(x) - type(y);
    if (t) return t;
    if (typeof x === "string" && typeof y === "string") {
      x = new TextEncoder().encode(x);
      y = new TextEncoder().encode(y);
    }
    const n = x instanceof Uint8Array && y instanceof Uint8Array
      ? bytes(x, y)
      : Object.is(x, y)
      ? 0
      : typeof x === "number" && typeof y === "number" && x === 0 && y === 0
      ? Object.is(x, -0) ? -1 : 1
      : typeof x === "number" && Number.isNaN(x)
      ? 1
      : typeof y === "number" && Number.isNaN(y)
      ? -1
      : x < y
      ? -1
      : 1;
    if (n) return n;
  }
  return a.length - b.length;
}

export function versionedKv(raw: Deno.Kv): Deno.Kv {
  if (controllers.has(raw)) return raw;
  const scopes = new AsyncLocalStorage<Scope>();
  const controller: Controller = {
    raw,
    scopes,
    async scope() {
      const s = scopes.getStore() ?? { head: await raw.get<string>(HEAD), started: Date.now() };
      alive(s);
      return s;
    },
  };
  const checkKey = (key: Deno.KvKey) => {
    if (key[0] === ROOT) throw new Error("Reserved dataset key");
  };
  function atomic(): Deno.AtomicOperation {
    const checks: Deno.AtomicCheck[] = [];
    const mutations: Deno.KvMutation[] = [];
    const w = {
      check(...items: Deno.AtomicCheck[]) {
        checks.push(...items);
        return w;
      },
      mutate(...items: Deno.KvMutation[]) {
        mutations.push(...items);
        return w;
      },
      set(key: Deno.KvKey, value: unknown, options?: { expireIn?: number }) {
        mutations.push({ type: "set", key, value, ...options });
        return w;
      },
      delete(key: Deno.KvKey) {
        mutations.push({ type: "delete", key });
        return w;
      },
      sum(key: Deno.KvKey, n: bigint) {
        mutations.push({ type: "sum", key, value: new Deno.KvU64(n) });
        return w;
      },
      min(key: Deno.KvKey, n: bigint) {
        mutations.push({ type: "min", key, value: new Deno.KvU64(n) });
        return w;
      },
      max(key: Deno.KvKey, n: bigint) {
        mutations.push({ type: "max", key, value: new Deno.KvU64(n) });
        return w;
      },
      async commit() {
        const s = await controller.scope();
        for (const item of [...checks, ...mutations]) checkKey(item.key);
        const op = raw.atomic();
        const durable = mutations.some((m) => datasetKey(m.key));
        // Reads of durable authority also bind a mixed (e.g. lease) transaction.
        if (!s.staging && (durable || checks.some((c) => datasetKey(c.key)))) op.check(s.head);
        op.check(...checks.map((c) => ({ ...c, key: physical(c.key, s) })));
        op.mutate(...mutations.map((m) => ({ ...m, key: physical(m.key, s) }) as Deno.KvMutation));
        if (durable && !s.staging) op.sum(REVISION, 1n);
        alive(s);
        const result = await op.commit();
        if (
          !result.ok && !s.staging && (await raw.get(HEAD)).versionstamp !== s.head.versionstamp
        ) throw conflict();
        return result;
      },
    };
    return w as unknown as Deno.AtomicOperation;
  }
  const wrapped = {
    async get<T>(key: Deno.KvKey, _options?: { consistency?: Deno.KvConsistencyLevel }) {
      checkKey(key);
      const s = await controller.scope();
      return { ...await raw.get<T>(physical(key, s)), key };
    },
    async getMany(
      keys: readonly Deno.KvKey[],
      _options?: { consistency?: Deno.KvConsistencyLevel },
    ) {
      keys.forEach(checkKey);
      const s = await controller.scope();
      return (await raw.getMany(keys.map((key) => physical(key, s)))).map((e, i) => ({
        ...e,
        key: keys[i],
      }));
    },
    async set(key: Deno.KvKey, value: unknown, options?: { expireIn?: number }) {
      const r = await atomic().set(key, value, options).commit();
      if (!r.ok) throw conflict();
      return r;
    },
    async delete(key: Deno.KvKey) {
      if (!(await atomic().delete(key).commit()).ok) throw conflict();
    },
    list<T>(selector: Deno.KvListSelector, options?: Deno.KvListOptions): Deno.KvListIterator<T> {
      // No application caller uses opaque native cursors. Refuse one rather than
      // accidentally applying a physical-generation cursor to a logical scan.
      if (options?.cursor) throw new Error("Dataset lists do not accept native cursors");
      const iterate = async function* () {
        const s = await controller.scope();
        const sel = selector as { prefix?: Deno.KvKey; start?: Deno.KvKey; end?: Deno.KvKey };
        for (const key of Object.values(sel)) checkKey(key);
        const opts = { ...options, limit: undefined, consistency: "strong" as const };
        const base = raw.list<T>(selector, opts);
        const mapped = Object.fromEntries(
          Object.entries(sel).map(([k, key]) => [k, [ROOT, "data", s.head.value, ...key]]),
        );
        const gen = s.head.value
          ? raw.list<T>(mapped as unknown as Deno.KvListSelector, opts)
          : null;
        async function next(
          iter: Deno.KvListIterator<T> | null,
          generated: boolean,
        ): Promise<Deno.KvEntry<T> | null> {
          if (!iter) return null;
          while (true) {
            const item = await iter.next();
            if (item.done) return null;
            const e = item.value;
            alive(s);
            const key = generated ? e.key.slice(3) : e.key;
            if (key[0] === ROOT || (s.head.value && datasetKey(key) !== generated)) continue;
            return { ...e, key };
          }
        }
        let a = await next(base, false), b = await next(gen, true), count = 0;
        while (a || b) {
          alive(s);
          const takeA = !b || (a && compare(a.key, b.key) * (options?.reverse ? -1 : 1) <= 0);
          yield (takeA ? a : b)!;
          if (++count >= (options?.limit ?? Infinity)) return;
          if (takeA) a = await next(base, false);
          else b = await next(gen, true);
        }
      };
      const iter = iterate();
      return Object.defineProperty(iter, "cursor", {
        get(): string {
          throw new Error("Dataset lists do not expose native cursors");
        },
      }) as unknown as Deno.KvListIterator<T>;
    },
    atomic,
    close: () => raw.close(),
    [Symbol.dispose]: () => raw[Symbol.dispose](),
  } as unknown as Deno.Kv;
  controllers.set(wrapped, controller);
  return wrapped;
}

export async function withDataset<T>(kv: Deno.Kv, run: () => Promise<T>): Promise<T> {
  const c = controllers.get(kv);
  if (!c || c.scopes.getStore()) return await run();
  return await c.scopes.run(await c.scope(), run);
}

/** Memory caches must be keyed by this value to avoid spanning publication. */
export async function datasetGeneration(kv: Deno.Kv): Promise<string> {
  return (await controllers.get(kv)?.scope())?.head.value ?? "initial";
}

/** Work is invisible until successful publication. The revision check detects
 * every concurrent durable write, including writers that passed maintenance's
 * short-lived cache. External effects (AI charges, audit logs) aren't rolled back. */
export async function stageDataset<T>(
  kv: Deno.Kv,
  run: () => Promise<T>,
  checks: Deno.AtomicCheck[] = [],
  now: () => number = () => Date.now() / 1000,
): Promise<T> {
  const c = controllers.get(kv);
  if (!c) throw new Error("Versioned database required");
  if (c.scopes.getStore()?.staging) return await run();
  const source = await c.scope();
  const revision = await c.raw.get(REVISION);
  const id = crypto.randomUUID();
  const stage: Scope = {
    head: { key: HEAD, value: id, versionstamp: "staging" },
    started: Date.now(),
    staging: true,
    outcomes: [],
  };
  await c.raw.set([ROOT, "staging", id], { at: Date.now() });
  const stagingMarker = await c.raw.get([ROOT, "staging", id]);
  let publicationAttempted = false;
  try {
    // Bounded batches keep both large and non-ASCII values under KV's commit cap.
    await c.scopes.run(source, async () => {
      let op = c.raw.atomic(), count = 0, bytes = 0;
      for await (const e of kv.list({ prefix: [] })) {
        if (!datasetKey(e.key) || disposable(e.key)) continue;
        // Structured values can include byte arrays; serialize conservatively.
        const size = new TextEncoder().encode(JSON.stringify(e.value, (_k, v) =>
          typeof v === "bigint" ? String(v) : v)).length + 2048;
        if (count && (count >= 200 || bytes + size > 500_000)) {
          if (!(await op.commit()).ok) {
            throw conflict();
          }
          op = c.raw.atomic();
          count = 0;
          bytes = 0;
        }
        op.set(physical(e.key, stage), e.value);
        count++;
        bytes += size;
      }
      if (count && !(await op.commit()).ok) throw conflict();
    });
    await c.scopes.run(stage, async () => {
      for await (const e of kv.list<Comment>({ prefix: ["comment"] })) {
        const row = e.value;
        const expires = row.claimExpiresAt ?? row.createdAt + CLAIM_TTL_SECS;
        if (row.status === "held" && row.claimToken && expires > now()) {
          await kv.set(["claim", row.claimToken], row.id, {
            expireIn: (expires - now()) * 1000,
          });
        }
      }
    });
    const result = await c.scopes.run(stage, run);
    alive(stage);
    alive(source);
    const retired = source.head.value ?? "initial";
    const op = c.raw.atomic().check(source.head, revision, stagingMarker, ...checks)
      .set(HEAD, id).sum(REVISION, 1n)
      .set([ROOT, "retired", retired], { at: Date.now() })
      .delete([ROOT, "staging", id]);
    publicationAttempted = true;
    const published = await op.commit();
    if (!published.ok) throw conflict();
    // The publishing request may still invalidate caches or serialize its result.
    source.head = { key: HEAD, value: id, versionstamp: published.versionstamp };
    for (const outcome of stage.outcomes!) {
      try {
        outcome(true);
      } catch { /* Auditing cannot undo publication. */ }
    }
    return result;
  } catch (e) {
    for (const outcome of stage.outcomes!) {
      try {
        outcome(false);
      } catch { /* Keep the original failure. */ }
    }
    // A transport failure may hide a successful CAS. Never erase a possibly
    // published generation; the delayed collector resolves uncertain outcomes.
    if (!publicationAttempted) await removeGeneration(c.raw, id).catch(() => {});
    throw e;
  }
}
async function removeGeneration(raw: Deno.Kv, id: string) {
  if ((await raw.get<string>(HEAD)).value === id) return;
  for await (const e of raw.list({ prefix: id === "initial" ? [] : [ROOT, "data", id] })) {
    if (id !== "initial" || datasetKey(e.key)) await raw.delete(e.key);
  }
  await raw.delete([ROOT, "staging", id]);
  await raw.delete([ROOT, "retired", id]);
}
/** Retain old generations longer than the maximum request/staging scope. */
export async function collectDatasets(kv: Deno.Kv): Promise<void> {
  const c = controllers.get(kv);
  if (!c) return;
  for (const kind of ["retired", "staging"]) {
    for await (const e of c.raw.list<{ at: number }>({ prefix: [ROOT, kind] })) {
      const id = String(e.key[2]);
      const head = await c.raw.get<string>(HEAD);
      if (Date.now() - e.value.at <= RETAIN_MS || head.value === id) continue;
      // A delayed publication must lose its CAS once collection starts.
      if (!(await c.raw.atomic().check(head, e).delete(e.key).commit()).ok) continue;
      await removeGeneration(c.raw, id);
    }
  }
}

/** Defer successful per-item audit outcomes until publication is known. */
export function datasetOutcome(kv: Deno.Kv, outcome: (committed: boolean) => void): void {
  const scope = controllers.get(kv)?.scopes.getStore();
  if (scope?.staging) scope.outcomes!.push(outcome);
  else outcome(true);
}
/** A validated batch may return its errors without publishing any successful items. */
export class DatasetAbort<T> extends Error {
  constructor(public result: T) {
    super("Administrative batch rolled back");
  }
}
