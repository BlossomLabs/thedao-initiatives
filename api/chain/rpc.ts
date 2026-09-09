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
    let lastErr: unknown = null;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      try {
        const res = await f(opts.endpoints[i], {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "thedao-rfps/2.0",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${opts.endpoints[i]}`);
        const out = await res.json() as { result?: unknown; error?: unknown };
        if (out.error) throw new RpcError(JSON.stringify(out.error));
        lastGood = i;
        return out.result ?? null;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new RpcError(`all RPC endpoints failed: ${String(lastErr)}`);
  };
}

export const ethCall = (rpc: Rpc, to: string, data: string): Promise<unknown> =>
  rpc("eth_call", [{ to, data }, "latest"]);

export async function getBlockNumber(rpc: Rpc): Promise<number> {
  const h = await rpc("eth_blockNumber", []);
  return h ? Number(BigInt(String(h))) : 0;
}
