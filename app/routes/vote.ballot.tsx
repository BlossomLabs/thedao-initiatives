import VotePage from "~/components/vote/VotePage";

export function meta() {
  return [{ title: "Your ballot · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** /vote/ballot: the signed-in account's ballot, found by its badge (no code). */
export default function MyBallot() {
  return <VotePage myBallot />;
}
