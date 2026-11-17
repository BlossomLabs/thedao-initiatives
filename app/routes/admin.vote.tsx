import { useRound, useVoteEnvironment } from "~/lib/vote-round";
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

export function meta({ location }: { location: { pathname: string } }) {
  return generateMeta({
    title: location.pathname.endsWith("vote-test") ? "Test vote" : "Production vote",
    url: location.pathname,
    noIndex: true,
  });
}

/** Qualifying for the vote: set once, changed rarely, so off the dashboard. */
export default function VotePage() {
  const round = useRound();
  const env = useVoteEnvironment();
  return (
    <PageMain detail className="max-w-[860px]">
      <Crumbs items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]} />
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        {env === "test" ? "Test vote" : "Production vote"}
      </h1>
      <p className="small dim mt-2.5">
        When an initiative can go to TheDAO's vote, whether the site shows it, and the round it
        runs.
      </p>
      {env === "production" && <VoteSettings />}
      <VoteRound />
      {roundDeployed(round) && <VoteRelayer />}
    </PageMain>
  );
}
