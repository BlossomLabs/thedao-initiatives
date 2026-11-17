/** After a bulk approve: the model writes each approved initiative's vote card summary
 * (#96), one request per initiative (~10 s each), a few at a time, so no request comes
 * near the platform's time limit. */

/** Requests in flight at once. */
export const SUMMARY_CONCURRENCY = 3;

export type SummaryProgress = {
  done: number;
  total: number;
  failed: { id: string; error: string }[];
};

/** Run `write` for every id, `concurrency` at a time, reporting after each; stops taking
 * new ids once `stopped()` (the page went away): what's written stays written. */
export async function writeSummaries(
  ids: string[],
  write: (id: string) => Promise<void>,
  onProgress: (p: SummaryProgress) => void,
  stopped: () => boolean = () => false,
  concurrency = SUMMARY_CONCURRENCY,
): Promise<SummaryProgress> {
  const p: SummaryProgress = { done: 0, total: ids.length, failed: [] };
  const queue = [...ids];
  onProgress({ ...p });
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let id = queue.shift(); id !== undefined && !stopped(); id = queue.shift()) {
      try {
        await write(id);
      } catch (e) {
        p.failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
      p.done++;
      onProgress({ ...p, failed: [...p.failed] });
    }
  }));
  return p;
}
