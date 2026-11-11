import { Navigate } from "react-router";
import PageMain from "~/components/layout/PageMain";
import { Button } from "~/components/ui/Button";
import VoteResults from "~/components/vote/VoteResults";
import { useSession } from "~/context/session";
import { useWalletPicker } from "~/context/wallet-picker";
import { useMyBadges } from "~/hooks/use-vote";
import { ROUND, roundDeployed } from "../../shared/vote/manifest";

export function meta() {
  return [{ title: "Vote · TheDAO" }, { name: "robots", content: "noindex" }];
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

/** /vote: a test vote's results, for its voters and admins only. The real vote's
 * results are the front page, so it goes there. */
export default function VoteRoute() {
  const { session } = useSession();
  const { openWalletPicker } = useWalletPicker();
  const test = roundDeployed() && ROUND.kind === "test";
  const badges = useMyBadges(session?.address ?? null, test);

  if (!roundDeployed()) return <Note title="There's no vote right now." />;
  if (ROUND.kind === "real") return <Navigate to="/" replace />;
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
