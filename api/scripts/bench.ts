/**
 * Latency bench for the public read endpoints. Prints p50/p95 time to first
 * byte, total time and wire bytes (gzip accepted) so every performance PR can
 * paste before/after numbers.
 *
 *   deno task bench https://initiatives.thedao.fund [samples] [slug]
 */

export interface BenchRow {
  path: string;
  samples: number;
  ttfbP50: number;
  ttfbP95: number;
  totalP50: number;
  bytes: number;
  status: number;
}

/** Linear-interpolated percentile (0..100) over unsorted samples; 0 when empty. */
export function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

async function sample(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ttfb: number; total: number; bytes: number; status: number }> {
  const t0 = performance.now();
  const res = await fetchImpl(url, { headers: { "accept-encoding": "gzip" } });
  const ttfb = performance.now() - t0;
  const body = await res.arrayBuffer();
  const total = performance.now() - t0;
  const bytes = Number(res.headers.get("content-length")) || body.byteLength;
  return { ttfb, total, bytes, status: res.status };
}

/** One warm-up request per path, then `n` timed samples each. */
export async function runBench(
  base: string,
  paths: string[],
  n: number,
  fetchImpl: typeof fetch = fetch,
): Promise<BenchRow[]> {
  const root = base.replace(/\/+$/, "");
  const rows: BenchRow[] = [];
  for (const path of paths) {
    const url = root + path;
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(await sample(url, fetchImpl));
    rows.push({
      path,
      samples: runs.length,
      ttfbP50: percentile(runs.map((r) => r.ttfb), 50),
      ttfbP95: percentile(runs.map((r) => r.ttfb), 95),
      totalP50: percentile(runs.map((r) => r.total), 50),
      bytes: runs.at(-1)?.bytes ?? 0,
      status: runs.at(-1)?.status ?? 0,
    });
  }
  return rows;
}

export function formatTable(rows: BenchRow[]): string {
  const ms = (v: number) => `${Math.round(v)} ms`;
  const lines = [["path", "n", "ttfb p50", "ttfb p95", "total p50", "bytes", "status"]];
  for (const r of rows) {
    lines.push([
      r.path,
      String(r.samples),
      ms(r.ttfbP50),
      ms(r.ttfbP95),
      ms(r.totalP50),
      String(r.bytes),
      String(r.status),
    ]);
  }
  const widths = lines[0].map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  return lines.map((l) => l.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}

if (import.meta.main) {
  const base = Deno.args[0];
  if (!base) {
    console.error("usage: deno task bench <base-url> [samples] [initiative-slug]");
    Deno.exit(2);
  }
  const n = Number(Deno.args[1] ?? 10);
  let slug = Deno.args[2];
  if (!slug) {
    const board = await (await fetch(base.replace(/\/+$/, "") + "/api/board")).json();
    slug = board?.cards?.[0]?.initiative?.slug;
  }
  const paths = ["/healthz", "/api/board"];
  if (slug) paths.push(`/api/initiatives/${encodeURIComponent(slug)}`);
  console.log(formatTable(await runBench(base, paths, n)));
}
