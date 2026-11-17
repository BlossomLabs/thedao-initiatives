import { lazy, Suspense, useEffect, useState } from "react";
import BoardPage from "~/components/board/BoardPage";
import { roundDeployed } from "../../shared/vote/manifest";
import { primeRound } from "~/lib/vote-round";
import { useBoard } from "~/hooks/use-board";

import { generateMeta } from "~/utils/meta";

export function meta() {
  // Agents find the index from the page head; relative so a preview host serves its own.
  return [
    ...generateMeta({ url: "/" }),
    { tagName: "link", rel: "alternate", type: "text/plain", title: "llms.txt", href: "/llms.txt" },
  ];
}

// Its code (the tally, the donate previews) loads only once the vote is open, not
// for every board visit.
const VoteResults = lazy(() => import("~/components/vote/VoteResults"));

export default function Board() {
  const board = useBoard();
  const manifest = board.data?.flags.round?.manifest;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const vote = hydrated && manifest?.kind === "real" && roundDeployed(manifest) &&
    Date.now() / 1000 >= manifest.opensAt;
  useEffect(() => {
    if (manifest?.kind === "real") primeRound(manifest, "production");
  }, [manifest]);
  return vote
    ? (
      <Suspense fallback={<BoardPage />}>
        <VoteResults />
      </Suspense>
    )
    : <BoardPage />;
}
