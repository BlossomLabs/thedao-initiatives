import { useEffect, useMemo, useRef } from "react";
import { Navigate, useParams } from "react-router";
import VoteResults from "~/components/vote/VoteResults";
import { setVoteClock } from "~/components/vote/When";
import {
  isResultMockId,
  MOCK_NOW,
  mockRound,
  RESULT_MOCKS,
  withGive,
} from "~/components/vote/mock-round";
import { useBoard } from "~/hooks/use-board";

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
  const example = useMemo(() => {
    if (!kind || !board.data) return undefined;
    const { round, view } = mockRound(kind, board.data.cards, 1);
    return { round, view: withGive(view, round, board.data.cards) };
  }, [kind, board.data]);

  if (!kind) return <Navigate to="/vote/results/s-settling" replace />;
  if (!example) return null;
  return <VoteResults example={example} />;
}
