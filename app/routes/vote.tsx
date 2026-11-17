import { useRound } from "~/lib/vote-round";

import PageMain from "~/components/layout/PageMain";
import { Button } from "~/components/ui/Button";
import VoteResults from "~/components/vote/VoteResults";
import { useSession } from "~/context/session";
import { useWalletPicker } from "~/context/wallet-picker";
import { useMyBadges } from "~/hooks/use-vote";
import { roundDeployed } from "../../shared/vote/manifest";
import { roundLoader } from "~/lib/vote-round";

/** The round the site runs now, before the page shows it. */
export const clientLoader = roundLoader;

export function meta({ location }: { location: { pathname: string } }) {
  return [{
    title: `${
      location.pathname.startsWith("/vote-test") ? "Test vote" : "Production vote"
    } · TheDAO`,
  }, { name: "robots", content: "noindex" }];
}

function Note({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <PageMain narrow className="pt-8">
      <div className="card text-[15px] leading-relaxed text-white/80">
        <h1 className="mb-3 font-inter-tight text-[28px] font-semibold leading-tight tracking-[-.01em] text-white">
          {title}
        </h1>
        {children}
      </div>
    </PageMain>
  );
}

/** Each environment has its own results. Test results require a voter or admin. */
export default function VoteRoute() {
  const ROUND = useRound();

  const { session } = useSession();
  const { openWalletPicker } = useWalletPicker();
  const test = roundDeployed(ROUND) && ROUND.kind === "test";
  const badges = useMyBadges(session?.address ?? null, test);

  if (!roundDeployed(ROUND)) return <Note title="There's no vote right now." />;
  if (ROUND.kind === "real") return <VoteResults />;
  if (session?.isAdmin || badges.data?.length) return <VoteResults />;
  if (!session) {
    return (
      <Note title="This page is for voters.">
        <p>Sign in with the account you claimed your test badge with.</p>
        <Button className="mt-4" onClick={openWalletPicker}>Sign in</Button>
      </Note>
    );
  }
  if (badges.isPending) return null;
  return (
    <Note title="This page is for voters.">
      <p>Your account has no badge in this test vote.</p>
    </Note>
  );
}
