/** Display-name rules shared by comments, replies and profiles. */
import { HttpError } from "../lib/errors.ts";
import type { Ens } from "./ens.ts";

const ETH_NAME_RE = /\.eth$/i;

/**
 * A name ending in .eth is only allowed when it is an ENS name that
 * forward-resolves to the wallet using it. Without a wallet it is never
 * allowed, so nobody can post as somebody else's ENS name.
 */
export async function assertEthNameOwned(
  ens: Ens,
  name: string,
  address: string,
): Promise<void> {
  const n = name.trim();
  if (!n || !ETH_NAME_RE.test(n)) return;
  if (!address) {
    throw new HttpError(
      400,
      `Names ending in .eth are reserved for their ENS owner. Connect the wallet that owns ${n} to use it.`,
    );
  }
  const owner = await ens.forward(n);
  if (!owner || owner.toLowerCase() !== address.toLowerCase()) {
    throw new HttpError(
      403,
      `You can only use an ENS name you own. Connect the wallet that ${n} points to.`,
    );
  }
}
