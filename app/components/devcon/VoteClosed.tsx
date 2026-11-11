import { useMemo } from "react";
import { bytesToHex, hexToBytes } from "viem";
import { Button, LinkButton } from "~/components/ui/Button";
import { TIER_LABELS } from "~/components/devcon/TierBallot";
import { useDevconBallots } from "~/hooks/use-devcon";
import { errorMessage } from "~/lib/api";
import { decodeBallot, encodeBallot, type Tier } from "../../../shared/devcon/ballot";
import { DEVCON } from "../../../shared/devcon/manifest";

function Header({ kicker, children }: { kicker: string; children?: React.ReactNode }) {
  return (
    <header className="pt-4 text-center">
      <p className="kicker m-0">{kicker}</p>
      <h1 className="mt-3 font-inter-tight text-[clamp(28px,5vw,40px)] font-bold leading-[1.1] tracking-[-.03em] text-white">
        Voting has closed
      </h1>
      {children && (
        <p className="mx-auto mt-3 max-w-[540px] font-inter-tight text-[16px] leading-snug text-white/70">
          {children}
        </p>
      )}
    </header>
  );
}

const NOTHING: Partial<Record<string, Tier>> = {};

const SeeResult = () => (
  <div className="flex justify-center">
    <LinkButton variant="primary" to="/devcon">See the result</LinkButton>
  </div>
);

/** After the close, in place of the welcome page and the ballot: says the vote is
 * over and, for the badge's owner, shows the ballot they sent (read from the chain,
 * so it shows on any device). `n` is null for a code nobody claimed. */
export default function VoteClosed(
  { n, titles, closeText, saved = NOTHING }: {
    n: number | null;
    /** This browser's tiers for the badge: shown when they are what was sent, since
     * the chain's ranks can't tell an empty A from an empty S. */
    saved?: Partial<Record<string, Tier>>;
    titles: ReadonlyMap<string, string>;
    closeText: string;
  },
) {
  const ballots = useDevconBallots();
  const sent = useMemo(() => {
    if (n === null || !ballots.data) return undefined;
    const b = ballots.data.ballots.find((x) => x.tokenId === String(n));
    if (!b) return null;
    const same = bytesToHex(encodeBallot(DEVCON.slugs, saved)).toLowerCase() ===
      b.ballot.toLowerCase();
    return same ? saved : decodeBallot(hexToBytes(b.ballot), DEVCON.slugs);
  }, [ballots.data, n, saved]);

  if (n === null) {
    return (
      <div className="space-y-6">
        <Header kicker="Devcon 8 · Demo vote on Sepolia">
          The Devcon demo vote ended {closeText}. Thanks for stopping by!
        </Header>
        <SeeResult />
      </div>
    );
  }

  let ballot: React.ReactNode;
  if (ballots.isPending) {
    ballot = <p className="text-white/60">Loading your ballot…</p>;
  } else if (ballots.isError) {
    ballot = (
      <>
        <p>We couldn't load your ballot right now. {errorMessage(ballots.error)}</p>
        <Button className="mt-4" onClick={() => ballots.refetch()}>Try again</Button>
      </>
    );
  } else if (!sent || Object.keys(sent).length === 0) {
    ballot = <p>This badge didn't send a ballot before voting closed.</p>;
  } else {
    ballot = (
      <div className="space-y-5">
        {TIER_LABELS.map(({ tier, label }) => {
          const slugs = DEVCON.slugs.filter((s) => sent[s] === tier);
          if (slugs.length === 0) return null;
          return (
            <section key={tier} aria-label={`${tier} · ${label}`}>
              <h3 className="mb-2 flex items-baseline gap-2 text-[13px] uppercase tracking-[.08em] text-white/55">
                <span className="font-inter-tight text-[18px] font-bold text-dao-green">
                  {tier}
                </span>
                {label}
              </h3>
              <ul className="space-y-1.5">
                {slugs.map((s) => <li key={s} className="text-white">{titles.get(s) ?? s}</li>)}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header kicker={`Devcon badge #${n} · Demo vote on Sepolia`}>
        The Devcon demo vote ended {closeText}. Here is what your badge voted.
      </Header>
      <div className="card text-[15px] leading-relaxed text-white/80">
        <h2 className="k">Your ballot</h2>
        {ballot}
      </div>
      <SeeResult />
    </div>
  );
}
