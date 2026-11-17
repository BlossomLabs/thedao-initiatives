import { Link, useLocation } from "react-router";
import { useRound, useVoteEnvironment, VoteEnvironmentContext } from "~/lib/vote-round";
import { environmentForPath, voteLabel } from "../../../shared/vote/environment";
import { roundDeployed } from "../../../shared/vote/manifest";

export function VoteEnvironmentProvider({ children }: { children: React.ReactNode }) {
  const env = environmentForPath(useLocation().pathname);
  return (
    <VoteEnvironmentContext.Provider value={env}>
      <div key={env}>{children}</div>
    </VoteEnvironmentContext.Provider>
  );
}
export function VoteEnvironmentBanner() {
  const env = useVoteEnvironment();
  const round = useRound();
  const { pathname } = useLocation();
  const productionResults = pathname === "/" && round.kind === "real" &&
    roundDeployed(round) && Date.now() / 1000 >= round.opensAt;
  if (!productionResults && !/^\/(?:admin\/)?vote(?:-test)?(?:\/|$)/.test(pathname)) return null;
  const demo = /^\/vote-test\/(mock|results|effects)(?:\/|$)/.test(pathname);
  const admin = pathname.startsWith("/admin/");
  return (
    <aside
      aria-label="Vote environment"
      className={`border-b px-4 py-3 text-sm ${
        env === "test"
          ? "border-amber-300/40 bg-amber-300/15 text-amber-100"
          : "border-dao-green/40 bg-dao-green/10 text-white"
      }`}
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2">
        <div>
          <strong>{demo ? "Demonstration" : voteLabel(env)}</strong> · {env === "test"
            ? "Sepolia · Does not affect production allocations."
            : "Ethereum · Votes determine production allocations."}
          {!demo && roundDeployed(round) && (
            <span className="mt-1 block break-all font-mono text-xs opacity-75">
              Round {round.contract}
            </span>
          )}
        </div>
        <Link
          to={`${admin ? "/admin" : ""}${env === "test" ? "/vote" : "/vote-test"}`}
          className="underline"
        >
          Open {env === "test" ? "production" : "test"} vote
        </Link>
      </div>
    </aside>
  );
}
