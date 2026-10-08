import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import VoteSettings from "~/components/admin/VoteSettings";
import { generateMeta } from "~/utils/meta";

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
        When an initiative can go to TheDAO's vote, and whether the site shows it.
      </p>
      <VoteSettings />
    </PageMain>
  );
}
