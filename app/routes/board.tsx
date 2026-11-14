import { lazy, Suspense, useEffect, useState } from "react";
import BoardPage from "~/components/board/BoardPage";
import { ROUND, roundDeployed } from "../../shared/vote/manifest";
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

/** The real vote shows its results on the front page from the moment it opens. */
const realVoteOpen = () =>
  roundDeployed() && ROUND.kind === "real" && Date.now() / 1000 >= ROUND.opensAt;

export default function Board() {
  // The prerendered page is the board, so the first render is too (hydration must
  // match); the vote results take over right after, once the clock is known.
  const [vote, setVote] = useState(false);
  useEffect(() => setVote(realVoteOpen()), []);
  return vote
    ? (
      <Suspense fallback={<BoardPage />}>
        <VoteResults />
      </Suspense>
    )
    : <BoardPage />;
}
