import { lazy, Suspense, useEffect, useState } from "react";
import BoardPage from "~/components/board/BoardPage";
import { ROUND, roundDeployed } from "../../shared/vote/manifest";
import { primeRound } from "~/lib/vote-round";
import { useBoard } from "~/hooks/use-board";
import { useVoteRound } from "~/hooks/use-vote";
import { withdrawnProjects } from "~/lib/vote-results";
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
  // match); the vote results take over right after, once the board's answer says the
  // real vote has opened. It carries the whole round then: no request of its own.
  const board = useBoard();
  const round = board.data?.flags.round;
  const [vote, setVote] = useState(false);
  useEffect(() => {
    if (round?.manifest) {
      primeRound(round.manifest);
      setVote(realVoteOpen());
    } else if (round !== undefined) setVote(false);
  }, [round?.contract, round?.manifest]);
  // A round that has opened but whose results aren't the front page (a test vote): the
  // board marks what an admin withdrew from it.
  const opened = Boolean(round?.manifest) && !vote &&
    Date.now() / 1000 >= (round?.manifest?.opensAt ?? Infinity);
  const [withdrawn, setWithdrawn] = useState<ReadonlySet<string>>();
  return vote
    ? (
      <Suspense fallback={<BoardPage />}>
        <VoteResults />
      </Suspense>
    )
    : (
      <>
        {opened && <ReadWithdrawn onRead={setWithdrawn} />}
        <BoardPage withdrawn={withdrawn} />
      </>
    );
}

/** Reads the round once, only while one runs without its results on the front page, and
 * hands up what an admin withdrew from it (an older body has none). Apart from the board,
 * so the board itself never remounts when it starts. */
function ReadWithdrawn({ onRead }: { onRead: (s: ReadonlySet<string>) => void }) {
  const rv = useVoteRound(false).data;
  useEffect(() => {
    if (rv) onRead(new Set(withdrawnProjects(rv.tiers, rv.live.withdrawn)));
  }, [rv, onRead]);
  return null;
}
