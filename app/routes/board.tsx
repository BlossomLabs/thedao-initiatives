import { useEffect } from "react";
import BoardPage from "~/components/board/BoardPage";
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

/** The front page is the board, also while the vote is open: its results are on /vote. */
export default function Board() {
  const board = useBoard();
  const manifest = board.data?.flags.round?.manifest;
  // The top bar's vote links (Vote, Results) need the round.
  useEffect(() => {
    if (manifest?.kind === "real") primeRound(manifest, "production");
  }, [manifest]);
  return <BoardPage />;
}
