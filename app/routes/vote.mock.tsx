import { useParams } from "react-router";
import VotePage from "~/components/vote/VotePage";

export function meta() {
  return [{ title: "Example ballot · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** /vote/mock/:id: the ballot at one moment of the vote, as an example anyone can open
 * (mock-round.ts), and its editor at /vote/mock/:id/edit. Nothing is sent from it. */
export default function MockBallot() {
  const { id } = useParams();
  return <VotePage mockId={id ?? ""} />;
}
