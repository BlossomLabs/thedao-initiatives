import type { RoundView } from "~/hooks/use-vote";
import { usd } from "~/lib/format";
import { tierName } from "../../../shared/vote/ballot";
import type { VoteManifest } from "../../../shared/vote/manifest";

/** Supporting evidence for the current funding figures; awards themselves stay fixed. */
export default function ValuationNotes({ view, round }: { view: RoundView; round: VoteManifest }) {
  const current = view.valuation;
  const settlements = view.tiers.flatMap((t) =>
    t.status === "settled" && t.valuation
      ? [{ ...t.valuation, context: `${tierName(t.tier)} settlement` }]
      : []
  );
  const evidence = [
    ...(current ? [{ ...current, context: "Current figures" }] : []),
    ...settlements,
  ];
  const changes = Object.entries(view.settlementCoverage ?? {}).filter(([, x]) =>
    x.shortfallUsd !== "0" || x.excessAwardUsd !== "0"
  );
  const notes = evidence.flatMap((v) => [
    ...(!v.available
      ? [`${v.context}: valuation diagnostics are unavailable for this round.`]
      : []),
    ...v.issues.flatMap((x) => {
      const project = round.slugs[x.project] ?? `Initiative ${x.project}`;
      const currency = round.currencies?.[x.currency]?.symbol ?? `Currency ${x.currency}`;
      const name = `${v.context}, ${project}, ${currency}`;
      return [
        ...(x.flags & 1 ? [`${name}: using the last stored good price.`] : []),
        ...(x.flags & 2 ? [`${name}: the balance could not be read and counts as zero.`] : []),
        ...(x.flags & 4 ? [`${name}: token precision changed; registered precision is used.`] : []),
        ...(x.flags & 8
          ? [`${name}: token precision could not be checked; registered precision is used.`]
          : []),
      ];
    }),
  ]);
  const pending = view.closed
    ? view.tiers.filter((t) => t.status === "settled" && t.confirmed === false)
    : [];
  if (!notes.length && !changes.length && !pending.length) return null;
  return (
    <>
      {pending.length > 0 && (
        <p className="mt-3 text-[13px] text-white/70">
          {pending.map((t) => tierName(t.tier)).join(", ")} settled, awaiting chain finality.
        </p>
      )}
      {(notes.length > 0 || changes.length > 0) && (
        <details className="mx-auto mt-4 max-w-[1052px] rounded-xl border border-white/10 p-3 text-left text-[13px] text-white/70">
          <summary className="cursor-pointer font-semibold text-white/85">Funding details</summary>
          {notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {notes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          )}
          {changes.length > 0 && (
            <>
              <p className="mt-2">
                Awards stay fixed. These comparisons use current asks and assume pool awards have
                not yet been paid.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {changes.map(([slug, x]) => (
                  <li key={slug}>
                    {slug}: award {usd(Number(x.awardUsd) / 1e6)}, current ask{" "}
                    {usd(Number(x.askUsd) / 1e6)}.
                    {x.shortfallUsd !== "0" &&
                      ` Current gap: ${usd(Number(x.shortfallUsd) / 1e6)}.`}
                    {x.excessAwardUsd !== "0" &&
                      ` Award above current ask: ${usd(Number(x.excessAwardUsd) / 1e6)}.`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </>
  );
}
