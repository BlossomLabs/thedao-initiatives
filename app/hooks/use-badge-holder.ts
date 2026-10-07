import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";

const BATCH = 50;
let queued = new Map<string, ((held: boolean) => void)[]>();
let scheduled = false;

/** Asks for every address queued in the same tick in one request (50 a call). */
function flush() {
  scheduled = false;
  const batch = queued;
  queued = new Map();
  const addresses = [...batch.keys()];
  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = addresses.slice(i, i + BATCH);
    void api<{ holders: string[] }>(`/api/badges?addresses=${chunk.join(",")}`)
      .then((r) => new Set(r.holders), () => new Set<string>())
      .then((held) => {
        for (const a of chunk) for (const done of batch.get(a) ?? []) done(held.has(a));
      });
  }
}

function holdsBadge(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    queued.set(address, [...(queued.get(address) ?? []), resolve]);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
}

/**
 * Whether an address holds the ETHSecurity badge, for the mark on its avatar.
 * The lookups of one render go out as one request; a failed one reads as "no
 * badge". `known` (a list that already says, like a comment's roles) skips it.
 */
export function useBadgeHolder(address: string | undefined | null, known?: boolean): boolean {
  const addr = (address ?? "").toLowerCase();
  const q = useQuery({
    queryKey: ["badge", addr],
    enabled: known === undefined && /^0x[0-9a-f]{40}$/.test(addr),
    staleTime: 30 * 60_000,
    queryFn: () => holdsBadge(addr),
  });
  return known ?? q.data === true;
}
