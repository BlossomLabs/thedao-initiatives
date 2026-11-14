import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import VoteResults from "~/components/vote/VoteResults";
import { setVoteClock } from "~/components/vote/When";
import {
  isResultMockId,
  MOCK_NOW,
  mockRound,
  RESULT_MOCKS,
  withFigures,
} from "~/components/vote/mock-round";
import { useBoard } from "~/hooks/use-board";
import type { RoundView } from "~/hooks/use-vote";

export function meta() {
  return [{ title: "Example vote results · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** /vote/results/:id: the vote results at one moment of the vote, as an example anyone
 * can open (mock-round.ts): the real round's dates, the board's initiatives, a made-up
 * tally. Nothing is donated from it. */
export default function ExampleResults() {
  const { id } = useParams();
  const board = useBoard();
  const kind = isResultMockId(id) ? RESULT_MOCKS[id] : null;
  // The page's clock runs from the example's moment in the round, then ticks on; back on
  // the real time on leaving.
  const clockFor = useRef<string | null>(null);
  if (kind && clockFor.current !== kind) {
    clockFor.current = kind;
    setVoteClock(MOCK_NOW[kind] * 1000);
  }
  useEffect(() => {
    if (kind) setVoteClock(MOCK_NOW[kind] * 1000);
    return () => setVoteClock(null);
  }, [kind]);
  const base = useMemo(() => {
    if (!kind || !board.data) return undefined;
    return mockRound(kind, board.data.cards, 1);
  }, [kind, board.data]);
  // The gaps and leads, as the server would work them out: the same searches over the
  // example's tally, a moment after it shows (until then, the list says it's working).
  const [figures, setFigures] = useState<{ for: typeof base; view: RoundView }>();
  useEffect(() => {
    if (!base) return;
    let gone = false;
    void withFigures(base.view, base.round).then((view) => {
      if (!gone) setFigures({ for: base, view });
    });
    return () => {
      gone = true;
    };
  }, [base]);
  const example = base && {
    round: base.round,
    view: figures?.for === base ? figures.view : base.view,
  };

  if (!kind) return <Navigate to="/vote/results/s-settling" replace />;
  if (!example) return null;
  return <VoteResults example={example} />;
}
