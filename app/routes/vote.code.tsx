import VotePage from "~/components/vote/VotePage";

export function meta() {
  return [{ title: "Your badge · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** /vote/:code: a paper code's welcome page, then its ballot. */
export default function VoteCode() {
  return <VotePage />;
}
