import VotePage from "~/components/vote/VotePage";
import { roundLoader } from "~/lib/vote-round";

/** The round the site runs now, before the page shows it. */
export const clientLoader = roundLoader;

/** Named as the page's heading (#139): the editor builds the ballot, the view shows it with
 * the results. */
export function meta({ location }: { location: { pathname: string } }) {
  const page = /\/edit\/?$/.test(location.pathname)
    ? "Build your ballot"
    : "Your ballot and results";
  const vote = location.pathname.startsWith("/vote-test") ? " · Test vote" : "";
  return [{ title: `${page}${vote} · TheDAO` }, { name: "robots", content: "noindex" }];
}

/** /vote/ballot: the signed-in account's ballot, found by its badge (no code); its editor
 * at /vote/ballot/edit. */
export default function MyBallot() {
  return <VotePage />;
}
