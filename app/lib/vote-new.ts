import type { RoundView } from "~/hooks/use-vote";

/** How many initiatives were put on the ballot after badge `tokenId` last sent its ballot
 * (a sent ballot lists the initiatives on it then), withdrawn ones aside. None before a
 * first send, when everything is still to rank anyway; none until the round says how long
 * each sent ballot was. */
export function newSinceSent(
  view: Pick<RoundView, "acceptedLengths" | "live"> | undefined,
  slugs: string[],
  tokenId: number | string,
): number {
  const sent = view?.acceptedLengths?.[String(tokenId)];
  if (sent === undefined) return 0;
  const out = new Set(view?.live.withdrawn ?? []);
  return slugs.slice(sent).filter((s) => !out.has(s)).length;
}
