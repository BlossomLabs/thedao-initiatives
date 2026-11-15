import VotePage from "~/components/vote/VotePage";
import { roundLoader } from "~/lib/vote-round";

/** The round the site runs now, before the page shows it. */
export const clientLoader = roundLoader;

export function meta() {
  return [{ title: "Your badge · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** /vote/:code: a paper code's welcome page, then its ballot; its editor at
 * /vote/:code/edit. */
export default function VoteCode() {
  return <VotePage />;
}
