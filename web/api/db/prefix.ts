/**
 * Namespaces every key under a fixed first part so several deployments
 * (preview, staging, production) can share one Deno KV database without
 * colliding. Configured with `DB_PREFIX`; empty means keys are stored as-is,
 * so existing databases keep working unchanged.
 *
 * The wrapper is transparent to the repos: keys built from `K` (and inline
 * list prefixes) are prefixed on the way in and stripped from returned
 * entries on the way out, so `entry.key[n]` positions and `check(entry)`
 * round-trips behave exactly as they do on a bare `Deno.Kv`.
 */
export function prefixedKv(kv: Deno.Kv, prefix: string): Deno.Kv {
  if (!prefix) return kv;
  const head: Deno.KvKeyPart[] = [prefix];
  const wrap = (key: Deno.KvKey): Deno.KvKey => [...head, ...key];
  const strip = (key: Deno.KvKey): Deno.KvKey => key.slice(head.length);
  const entry = <T>(e: Deno.KvEntryMaybe<T>): Deno.KvEntryMaybe<T> =>
    ({ ...e, key: strip(e.key) }) as Deno.KvEntryMaybe<T>;
  const check = (c: Deno.AtomicCheck): Deno.AtomicCheck => ({ ...c, key: wrap(c.key) });

  function atomic(op: Deno.AtomicOperation): Deno.AtomicOperation {
    const w = {
      check(...checks: Deno.AtomicCheck[]) {
        op.check(...checks.map(check));
        return w;
      },
      mutate(...mutations: Deno.KvMutation[]) {
        op.mutate(...mutations.map((m) => ({ ...m, key: wrap(m.key) }) as Deno.KvMutation));
        return w;
      },
      sum(key: Deno.KvKey, n: bigint) {
        op.sum(wrap(key), n);
        return w;
      },
      min(key: Deno.KvKey, n: bigint) {
        op.min(wrap(key), n);
        return w;
      },
      max(key: Deno.KvKey, n: bigint) {
        op.max(wrap(key), n);
        return w;
      },
      set(key: Deno.KvKey, value: unknown, options?: { expireIn?: number }) {
        op.set(wrap(key), value, options);
        return w;
      },
      delete(key: Deno.KvKey) {
        op.delete(wrap(key));
        return w;
      },
      enqueue(
        value: unknown,
        options?: { delay?: number; keysIfUndelivered?: Deno.KvKey[]; backoffSchedule?: number[] },
      ) {
        op.enqueue(value, {
          ...options,
          keysIfUndelivered: options?.keysIfUndelivered?.map(wrap),
        });
        return w;
      },
      commit: () => op.commit(),
    };
    return w as unknown as Deno.AtomicOperation;
  }

  function list<T>(
    selector: Deno.KvListSelector,
    options?: Deno.KvListOptions,
  ): Deno.KvListIterator<T> {
    const sel = { ...selector } as Record<string, Deno.KvKey>;
    for (const k of ["prefix", "start", "end"]) if (sel[k]) sel[k] = wrap(sel[k]);
    const inner = kv.list<T>(sel as unknown as Deno.KvListSelector, options);
    const iter = {
      get cursor() {
        return inner.cursor;
      },
      async next(): Promise<IteratorResult<Deno.KvEntry<T>, undefined>> {
        const r = await inner.next();
        return r.done ? r : { done: false, value: entry(r.value) as Deno.KvEntry<T> };
      },
      [Symbol.asyncIterator]() {
        return iter;
      },
    };
    return iter as unknown as Deno.KvListIterator<T>;
  }

  const wrapped = {
    get: <T>(key: Deno.KvKey, options?: { consistency?: Deno.KvConsistencyLevel }) =>
      kv.get<T>(wrap(key), options).then(entry),
    getMany: (keys: readonly Deno.KvKey[], options?: { consistency?: Deno.KvConsistencyLevel }) =>
      kv.getMany(keys.map(wrap), options).then((es) => es.map(entry)),
    set: (key: Deno.KvKey, value: unknown, options?: { expireIn?: number }) =>
      kv.set(wrap(key), value, options),
    delete: (key: Deno.KvKey) => kv.delete(wrap(key)),
    list,
    atomic: () => atomic(kv.atomic()),
    watch: (keys: readonly Deno.KvKey[], options?: { raw?: boolean }) =>
      kv.watch(keys.map(wrap), options).pipeThrough(
        new TransformStream<Deno.KvEntryMaybe<unknown>[], Deno.KvEntryMaybe<unknown>[]>({
          transform: (chunk, ctrl) => ctrl.enqueue(chunk.map(entry)),
        }),
      ),
    enqueue: (
      value: unknown,
      options?: { delay?: number; keysIfUndelivered?: Deno.KvKey[]; backoffSchedule?: number[] },
    ) =>
      kv.enqueue(value, { ...options, keysIfUndelivered: options?.keysIfUndelivered?.map(wrap) }),
    listenQueue: (handler: (value: unknown) => Promise<void> | void) => kv.listenQueue(handler),
    commitVersionstamp: () => kv.commitVersionstamp(),
    close: () => kv.close(),
    [Symbol.dispose]: () => kv[Symbol.dispose](),
  };
  return wrapped as unknown as Deno.Kv;
}
