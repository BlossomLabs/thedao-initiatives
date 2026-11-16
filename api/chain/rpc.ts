/** Mainnet JSON-RPC with endpoint failover, starting from the last endpoint
 * that worked so one flaky provider does not add a timeout to every call. */

export class RpcError extends Error {}

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export interface RpcOptions {
  endpoints: string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createRpc(opts: RpcOptions): Rpc {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let lastGood = 0;
  return async (method, params) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const n = opts.endpoints.length;
    if (n === 0) throw new RpcError("no RPC endpoints configured");
    const start = lastGood < n ? lastGood : 0;
    let lastFailure = "request failed";
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      // Fetch exceptions and provider payloads can echo credential-bearing URLs.
      // Retain only an endpoint ordinal and protocol status, never their text.
      lastFailure = `endpoint ${i + 1}: request failed`;
      try {
        const res = await f(opts.endpoints[i], {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "thedao-initiatives/2.0",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          lastFailure = `endpoint ${i + 1}: HTTP ${res.status}`;
          continue;
        }
        const out = await res.json() as { result?: unknown; error?: unknown };
        if (out.error) {
          const code = (out.error as { code?: unknown }).code;
          lastFailure = `endpoint ${i + 1}: JSON-RPC error` +
            (typeof code === "number" && Number.isFinite(code) ? ` ${code}` : "");
          continue;
        }
        lastGood = i;
        return out.result ?? null;
      } catch { /* Try the next endpoint without retaining exception text. */ }
    }
    throw new RpcError(`all RPC endpoints failed: ${lastFailure}`);
  };
}

export const ethCall = (rpc: Rpc, to: string, data: string): Promise<unknown> =>
  rpc("eth_call", [{ to, data }, "latest"]);

export async function getBlockNumber(rpc: Rpc): Promise<number> {
  const h = await rpc("eth_blockNumber", []);
  return h ? Number(BigInt(String(h))) : 0;
}
