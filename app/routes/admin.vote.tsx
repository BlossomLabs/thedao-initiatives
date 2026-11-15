import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import VoteSettings from "~/components/admin/VoteSettings";
import VoteRelayer from "~/components/admin/VoteRelayer";
import VoteRound from "~/components/admin/VoteRound";
import { roundDeployed } from "../../shared/vote/manifest";
import { generateMeta } from "~/utils/meta";
import { roundLoader } from "~/lib/vote-round";

/** The round the site runs now, before the page shows it. */
export const clientLoader = roundLoader;

export function meta() {
  return generateMeta({ title: "Vote", url: "/admin/vote", noIndex: true });
}

/** Qualifying for the vote: set once, changed rarely, so off the dashboard. */
export default function VotePage() {
  return (
    <PageMain detail className="max-w-[860px]">
      <Crumbs items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]} />
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        Vote
      </h1>
      <p className="small dim mt-2.5">
        When an initiative can go to TheDAO's vote, whether the site shows it, and the round it
        runs.
      </p>
      <VoteSettings />
      <VoteRound />
      {roundDeployed() && <VoteRelayer />}
    </PageMain>
  );
}
