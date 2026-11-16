import type { Hex } from "viem";

export type AccountChange = { block: number; logIndex: number; id: number; account: Hex };
export type AccountPeriod = { from: number; to: number; accounts: Hex[] };

/** End-of-block configurations. A label/goal/group edit is not an account change, and
 * multiple corrections in one block produce only that block's final configuration. */
export function accountPeriods(
  changes: AccountChange[],
  from: number,
  to: number,
): AccountPeriod[] {
  const ordered = [...changes].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const current = new Map<number, Hex>();
  const accounts = () => [...current.entries()].sort(([a], [b]) => a - b).map(([, a]) => a);
  const out: AccountPeriod[] = [];
  let start = from;
  for (let i = 0; i < ordered.length;) {
    const block = ordered[i].block;
    if (block > to) break;
    const before = accounts();
    while (i < ordered.length && ordered[i].block === block) {
      const x = ordered[i++];
      current.set(x.id, x.account.toLowerCase() as Hex);
    }
    if (block <= from) continue;
    if (before.join() === accounts().join()) continue;
    out.push({ from: start, to: block - 1, accounts: before });
    start = block;
  }
  if (start <= to) out.push({ from: start, to, accounts: accounts() });
  return out;
}
