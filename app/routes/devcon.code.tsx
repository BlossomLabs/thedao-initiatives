import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { bytesToHex, type Hex } from "viem";
import PageMain from "~/components/layout/PageMain";
import { Button } from "~/components/ui/Button";
import TierBallot from "~/components/devcon/TierBallot";
import BallotStatus from "~/components/devcon/BallotStatus";
import { useSession } from "~/context/session";
import { useWallet } from "~/context/wallet";
import { useWalletPicker } from "~/context/wallet-picker";
import { useBoard } from "~/hooks/use-board";
import { apiCode, useBallotSubmit, useDevconCode, useMintWait } from "~/hooks/use-devcon";
import { api, errorMessage } from "~/lib/api";
import { usd } from "~/lib/format";
import { encodeBallot, type Tier } from "../../shared/devcon/ballot";
import { DEVCON } from "../../shared/devcon/manifest";

export function meta() {
  return [{ title: "Badge holder for a day · TheDAO" }, { name: "robots", content: "noindex" }];
}

const POOL = Number(BigInt(DEVCON.poolUsd) / 1_000_000n);
const closed = () => Date.now() / 1000 >= DEVCON.closesAt;
const closeText = "Friday 6 November, midnight in Mumbai";

const tiersKey = (n: number) => `devcon-tiers:${DEVCON.contract}:${n}`;
function loadTiers(n: number): Partial<Record<string, Tier>> {
  try {
    return JSON.parse(localStorage.getItem(tiersKey(n)) ?? "{}");
  } catch {
    return {};
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-6 text-[15px] leading-relaxed text-white/80">
      {children}
    </div>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mb-3 font-inter-tight text-[28px] font-semibold leading-tight text-white">
      {children}
    </h1>
  );
}

function Intro(
  { onAccept, busy, note }: { onAccept: () => void; busy: boolean; note?: React.ReactNode },
) {
  return (
    <Card>
      <Headline>You're a TheDAO badge holder. For one day.</Headline>
      <p>
        Rank the security initiatives TheDAO could fund from a{" "}
        <b className="text-white">{usd(POOL)}</b>{" "}
        pool. Every ballot moves the result live on the big screen.
      </p>
      <p className="mt-2 text-white/60">Voting closes {closeText}.</p>
      <Button variant="primary" className="mt-5 w-full" disabled={busy} onClick={onAccept}>
        {busy ? "One moment…" : "Accept the challenge"}
      </Button>
      {note && <div className="mt-4">{note}</div>}
    </Card>
  );
}

export default function DevconCode() {
  const code = useParams().code ?? "";
  const qc = useQueryClient();
  const info = useDevconCode(code);
  const { session, signOut } = useSession();
  const { address } = useWallet();
  const { openWalletPicker } = useWalletPicker();
  const board = useBoard();
  const mint = useMintWait();
  // Ballots are signed by the connected wallet, so it has to be the signed-in one.
  const me = session && address && session.address.toLowerCase() === address.toLowerCase()
    ? session.address
    : null;

  const [accepted, setAccepted] = useState(false);
  const [claim, setClaim] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "error"; code?: string; message: string }
  >({ kind: "idle" });

  const data = info.data;
  const n = data && data !== "bad" ? data.n : null;
  const owner = data && data !== "bad" ? data.owner : null;
  const mine = Boolean(me && owner && owner.toLowerCase() === me.toLowerCase());
  const ballotFlow = useBallotSubmit(mine && n !== null ? BigInt(n) : null);

  const doClaim = async () => {
    setClaim({ kind: "busy" });
    try {
      const { hash } = await api<{ hash: Hex }>("/api/devcon/claim", {
        method: "POST",
        json: { code },
      });
      await mint.wait(hash);
      await qc.invalidateQueries({ queryKey: ["devcon-code", code] });
      setClaim({ kind: "idle" });
    } catch (e) {
      setClaim({ kind: "error", code: apiCode(e), message: errorMessage(e) });
    }
  };

  // Accepted while signed out: claim as soon as the sign-in lands.
  useEffect(() => {
    if (accepted && me && data && data !== "bad" && !data.claimed && claim.kind === "idle") {
      setAccepted(false);
      void doClaim();
    }
    // doClaim is stable enough for this one-shot trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted, me, data, claim.kind]);

  const [tiers, setTiers] = useState<Partial<Record<string, Tier>>>({});
  useEffect(() => {
    if (n !== null) setTiers(loadTiers(n));
  }, [n]);
  const setTier = (slug: string, tier: Tier | undefined) => {
    setTiers((prev) => {
      const next = { ...prev, [slug]: tier };
      if (!tier) delete next[slug];
      try {
        if (n !== null) localStorage.setItem(tiersKey(n), JSON.stringify(next));
      } catch { /* storage unavailable */ }
      return next;
    });
  };

  const items = useMemo(() => {
    const titles = new Map(board.data?.cards.map((c) => [c.initiative.slug, c.initiative.title]));
    return DEVCON.slugs.map((slug) => ({ slug, title: titles.get(slug) ?? slug }));
  }, [board.data]);

  let body: React.ReactNode;
  if (info.isPending) {
    body = <Card>Checking your code…</Card>;
  } else if (info.isError) {
    body = (
      <Card>
        <p>We couldn't check this code right now. {errorMessage(info.error)}</p>
        <Button className="mt-4" onClick={() => info.refetch()}>Try again</Button>
      </Card>
    );
  } else if (data === "bad") {
    body = (
      <Card>
        <Headline>This code doesn't look right.</Headline>
        <p>Try scanning it again, slowly. If it still fails, ask at the booth for a new one.</p>
      </Card>
    );
  } else if (data && data.claimed && !mine) {
    body = me
      ? (
        <Card>
          <Headline>This badge belongs to another account.</Headline>
          <p>
            You're signed in with a different one. Sign out, then sign in with the account you
            claimed it with.
          </p>
          <Button className="mt-4" onClick={() => void signOut()}>Sign out</Button>
        </Card>
      )
      : (
        <Card>
          <Headline>This badge is already taken.</Headline>
          <p>Already yours? Sign in with the account you claimed it with.</p>
          <Button className="mt-4" onClick={openWalletPicker}>Sign in</Button>
        </Card>
      );
  } else if (data && !data.claimed) {
    const note = claim.kind === "error"
      ? claim.code === "one_per_person"
        ? (
          <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-white">
            <b>Nice try, bad kid 😏</b> One badge per person.
          </p>
        )
        : claim.code === "smart_wallet"
        ? <p className="text-amber-200">Use email or a regular wallet for this one.</p>
        : claim.code === "closed"
        ? <p className="text-white/70">Voting has closed. Thanks for stopping by!</p>
        : <p className="text-red-300">{claim.message}</p>
      : claim.kind === "busy"
      ? <p className="text-white/60">Minting your one-day badge on Sepolia…</p>
      : null;
    body = (
      <Intro
        busy={claim.kind === "busy"}
        note={note}
        onAccept={() => {
          if (me) void doClaim();
          else {
            setAccepted(true);
            openWalletPicker();
          }
        }}
      />
    );
  } else if (data && mine && n !== null) {
    const isClosed = closed();
    const busy = ["signing", "relaying", "waiting"].includes(ballotFlow.phase.kind);
    const placed = Object.keys(tiers).length;
    body = (
      <div className="space-y-5">
        <Card>
          <Headline>Badge #{n}: your ballot</Headline>
          <p>
            Put what TheDAO must fund first. Proposals in the same tier are equal. The {usd(POOL)}
            {" "}
            pool is split equally between everyone who votes.
          </p>
          {isClosed && <p className="mt-2 font-medium text-white">Voting has closed.</p>}
        </Card>
        <TierBallot items={items} tiers={tiers} disabled={isClosed || busy} onChange={setTier} />
        <div className="sticky bottom-3 space-y-3 rounded-2xl border border-white/10 bg-panel/95 p-4 backdrop-blur">
          <BallotStatus phase={ballotFlow.phase} onRetry={() => void ballotFlow.retry()} />
          {!isClosed && (
            <Button
              variant="primary"
              className="w-full"
              disabled={busy || placed === 0}
              onClick={() =>
                void ballotFlow.submit(
                  BigInt(n),
                  bytesToHex(encodeBallot(DEVCON.slugs, tiers)),
                )}
            >
              {placed === 0 ? "Place at least one proposal" : "Send my ballot"}
            </Button>
          )}
        </div>
      </div>
    );
  } else {
    body = <Card>Checking your code…</Card>;
  }

  return <PageMain narrow className="pt-8">{body}</PageMain>;
}
