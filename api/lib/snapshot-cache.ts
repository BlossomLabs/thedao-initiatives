/**
 * One value kept in this isolate's memory for a few seconds, for a public
 * response that is the same for everyone and polled. Other isolates keep
 * their own copy, so a reader can be up to `ttlSecs` behind a write made
 * elsewhere; `ttlSecs` of 0 builds on every read.
 */
export interface SnapshotCache<T> {
  /** The saved value inside its window, else `build()`; concurrent readers share one build. */
  get(build: () => Promise<T>): Promise<T>;
  /** Always `build()`, then save the result and restart the window. Readers
   * keep getting the saved value meanwhile. */
  rebuild(build: () => Promise<T>): Promise<T>;
  /** Drop the saved value, and whatever a build already running will return. */
  clear(): void;
}

export function createSnapshotCache<T>(now: () => number, ttlSecs: number): SnapshotCache<T> {
  let saved: { value: T; until: number } | null = null;
  let inflight: Promise<T> | null = null;
  // Bumped by every save and clear: a build that started before one is not saved.
  let generation = 0;

  async function run(build: () => Promise<T>): Promise<T> {
    const started = generation;
    const value = await build();
    if (generation === started && ttlSecs > 0) {
      generation++;
      inflight = null;
      saved = { value, until: now() + ttlSecs };
    }
    return value;
  }

  return {
    get(build) {
      if (saved && now() < saved.until) return Promise.resolve(saved.value);
      if (inflight) return inflight;
      const p = run(build).finally(() => {
        if (inflight === p) inflight = null;
      });
      if (ttlSecs > 0) inflight = p;
      return p;
    },
    rebuild: run,
    clear() {
      generation++;
      inflight = null;
      saved = null;
    },
  };
}
