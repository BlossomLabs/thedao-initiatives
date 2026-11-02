import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { bytesToHex, type Hex } from "viem";
import PageMain from "~/components/layout/PageMain";
import { Button } from "~/components/ui/Button";
import TierBallot, { type BallotItem } from "~/components/devcon/TierBallot";
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
  return [{ title: "Devcon badge · TheDAO" }, { name: "robots", content: "noindex" }];
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

const acceptedKey = (code: string) => `devcon-accepted:${DEVCON.contract}:${code}`;
function loadAccepted(code: string): boolean {
  try {
    return sessionStorage.getItem(acceptedKey(code)) === "1";
  } catch {
    return false;
  }
}
function saveAccepted(code: string, v: boolean) {
  try {
    if (v) sessionStorage.setItem(acceptedKey(code), "1");
    else sessionStorage.removeItem(acceptedKey(code));
  } catch { /* storage unavailable */ }
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="card text-[15px] leading-relaxed text-white/80">{children}</div>;
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mb-3 font-inter-tight text-[28px] font-semibold leading-tight tracking-[-.01em] text-white">
      {children}
    </h1>
  );
}

const SECURITY_HUB = "https://securityhub.thedao.fund/";
const BLOSSOM = "https://blossom.software/budgeting";

function Out(
  { href, title, children }: { href: string; title: string; children: React.ReactNode },
) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-baseline gap-2 text-white hover:text-dao-green"
    >
      <span aria-hidden="true" className="text-dao-green">→</span>
      <span>
        <b className="font-medium">{title}</b>{" "}
        <span className="text-white/60 group-hover:text-dao-green/80">{children}</span>
      </span>
    </a>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 flex-none place-items-center rounded-full border border-[rgba(92,183,90,.5)] font-inter-tight text-[12px] text-dao-green tnum">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Intro(
  { onAccept, busy, note }: { onAccept: () => void; busy: boolean; note?: React.ReactNode },
) {
  return (
    <div className="space-y-5">
      <header className="pt-4 text-center">
        <p className="kicker m-0">Devcon 8 · Demo vote on Sepolia</p>
        <h1 className="mt-3 font-inter-tight text-[clamp(36px,9vw,56px)] font-bold leading-[1.05] tracking-[-.03em] text-white">
          Congrats!
        </h1>
        <p className="mx-auto mt-3 max-w-[540px] font-inter-tight text-[clamp(18px,3vw,22px)] leading-snug text-white/80">
          You're a TheDAO <span className="text-dao-green">Badge Holder</span> for a day
        </p>
      </header>
      <div className="shimmer shimmer-soft !my-6" />
      <Panel>
        <h2 className="k">What you'll do</h2>
        <p className="mb-4">
          TheDAO Security Fund backs initiatives that keep{" "}
          <span className="text-dao-green">Ethereum safe</span>. Its badge holders decide where the
          money goes, and today you're one of them.
        </p>
        <ol className="space-y-3">
          <Step n={1}>
            <b className="font-medium text-white">Claim your Devcon badge.</b>{" "}
            Sign in with a wallet or an email, and we will mint an NFT on Sepolia for you.
          </Step>
          <Step n={2}>
            <b className="font-medium text-white">Sort the security initiatives into tiers:</b>{" "}
            <span className="text-dao-green">S</span> Must fund ·{" "}
            <span className="text-dao-green">A</span> Should fund ·{" "}
            <span className="text-dao-green">B</span> Nice to have.
          </Step>
          <Step n={3}>
            <b className="font-medium text-white">Send your ballot.</b>{" "}
            It moves the live result on the big screen at the booth.
          </Step>
        </ol>
      </Panel>
      <Panel>
        <h2 className="k">How the money is split</h2>
        <p>
          A <b className="font-medium text-white">{usd(POOL)}</b>{" "}
          demo pool is split equally among voters. The ballots fund whole initiatives, highest tiers
          first, using Blossom's tier budgeting.
        </p>
        <p className="mt-2 text-white/60">
          It's a demo: no real funds move. Voting closes {closeText}.
        </p>
      </Panel>
      <Panel>
        <h2 className="k">Learn more</h2>
        <div className="space-y-2">
          <Out href={SECURITY_HUB} title="Security Hub">
            Come to discuss and learn about security initiatives around Ethereum
          </Out>
          <Out href={BLOSSOM} title="Blossom Budgeting">
            Learn how this participatory budgeting works
          </Out>
        </div>
      </Panel>
      <div className="pt-1 text-center">
        <Button variant="primary" className="w-full" disabled={busy} onClick={onAccept}>
          {busy ? "One moment…" : "Claim my Devcon badge"}
        </Button>
        {note && <div className="mt-4 text-left">{note}</div>}
      </div>
    </div>
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

  // Accepting survives the sign-in (the modal can remount or reload the page):
  // once signed in, the claim goes ahead without a second click.
  const [accepted, setAcceptedState] = useState(() => loadAccepted(code));
  const setAccepted = (v: boolean) => {
    setAcceptedState(v);
    saveAccepted(code, v);
  };
  const [claim, setClaim] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "error"; code?: string; message: string }
  >({ kind: "idle" });

  // Dev only: ?mock shows the ballot without a real code or a sign-in (stripped from builds).
  const [sp] = useSearchParams();
  const mock = import.meta.env.DEV && sp.has("mock");
  const data = mock ? { n: 1, claimed: true, owner: "0x0" } as const : info.data;
  const n = data && data !== "bad" ? data.n : null;
  const owner = data && data !== "bad" ? data.owner : null;
  const mine = mock || Boolean(me && owner && owner.toLowerCase() === me.toLowerCase());
  const ballotFlow = useBallotSubmit(mine && n !== null ? BigInt(n) : null);

  // One claim at a time: the sign-in lands in several renders, and the
  // auto-claim effect can fire again before its own state updates show.
  const claiming = useRef(false);
  const doClaim = async () => {
    if (claiming.current) return;
    claiming.current = true;
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
    } finally {
      claiming.current = false;
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

  const replaceTiers = (next: Partial<Record<string, Tier>>) => {
    setTiers(next);
    try {
      if (n !== null) localStorage.setItem(tiersKey(n), JSON.stringify(next));
    } catch { /* storage unavailable */ }
  };

  const items = useMemo<BallotItem[]>(() => {
    const cards = new Map(board.data?.cards.map((c) => [c.initiative.slug, c]));
    return DEVCON.slugs.map((slug) => {
      const card = cards.get(slug);
      return { slug, title: card?.initiative.title ?? slug, card };
    });
  }, [board.data]);

  let body: React.ReactNode;
  let wide = false;
  if (info.isPending && !mock) {
    body = <Panel>Checking your code…</Panel>;
  } else if (info.isError && !mock) {
    body = (
      <Panel>
        <p>We couldn't check this code right now. {errorMessage(info.error)}</p>
        <Button className="mt-4" onClick={() => info.refetch()}>Try again</Button>
      </Panel>
    );
  } else if (data === "bad") {
    body = (
      <Panel>
        <Headline>This code doesn't look right.</Headline>
        <p>Try scanning it again, slowly. If it still fails, ask at the booth for a new one.</p>
      </Panel>
    );
  } else if (data && data.claimed && !mine) {
    body = me
      ? (
        <Panel>
          <Headline>This badge belongs to another account.</Headline>
          <p>
            You're signed in with a different one. Sign out, then sign in with the account you
            claimed it with.
          </p>
          <Button className="mt-4" onClick={() => void signOut()}>Sign out</Button>
        </Panel>
      )
      : (
        <Panel>
          <Headline>This badge is already taken.</Headline>
          <p>Already yours? Sign in with the account you claimed it with.</p>
          <Button className="mt-4" onClick={openWalletPicker}>Sign in</Button>
        </Panel>
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
      ? <p className="text-white/60">Minting your Devcon badge on Sepolia…</p>
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
    wide = true;
    const isClosed = closed();
    const busy = ["signing", "relaying", "waiting"].includes(ballotFlow.phase.kind);
    const placed = Object.keys(tiers).length;
    const sendYourself = () =>
      void ballotFlow.selfSend(BigInt(n), bytesToHex(encodeBallot(DEVCON.slugs, tiers)));
    body = (
      <div className="space-y-6">
        <header className="pt-4 text-center">
          <p className="kicker m-0">Devcon badge #{n} · Demo vote on Sepolia</p>
          <h1 className="mt-3 font-inter-tight text-[clamp(28px,5vw,40px)] font-bold leading-[1.1] tracking-[-.03em] text-white">
            Your ballot
          </h1>
          <p className="mx-auto mt-3 max-w-[640px] font-inter-tight text-[16px] leading-snug text-white/70">
            Put what TheDAO must fund first. Initiatives in the same tier are equal. The {usd(POOL)}
            {" "}
            demo pool is split equally between everyone who votes.{" "}
            <a
              href={BLOSSOM}
              target="_blank"
              rel="noopener noreferrer"
              className="text-dao-green underline-offset-2 hover:underline"
            >
              How tier budgeting works
            </a>
          </p>
          {isClosed && <p className="mt-2 font-medium text-white">Voting has closed.</p>}
        </header>
        <TierBallot
          items={items}
          tiers={tiers}
          disabled={isClosed || busy}
          onChange={setTier}
          onReplace={replaceTiers}
          search={{ ai: board.data?.flags?.aiSearch, aiAuto: board.data?.flags?.aiSearchAuto }}
          actions={
            <div className="mx-auto max-w-[560px] space-y-3 rounded-2xl border border-white/10 bg-panel/95 p-4 shadow-[0_14px_30px_rgba(0,0,0,.35)] backdrop-blur sm:max-w-none sm:bg-white/[.03] sm:shadow-none sm:backdrop-blur-none">
              <BallotStatus
                phase={ballotFlow.phase}
                onRetry={() => void ballotFlow.retry()}
                selfSend={!isClosed && placed > 0 && (
                  <Button onClick={sendYourself}>Send it yourself</Button>
                )}
              />
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
              {!isClosed && ballotFlow.phase.kind !== "failed" && (
                <button
                  type="button"
                  disabled={busy || placed === 0}
                  onClick={sendYourself}
                  className="w-full text-center text-[13px] text-white/55 underline underline-offset-2 disabled:opacity-40"
                >
                  Send it yourself (from your wallet, on Sepolia)
                </button>
              )}
            </div>
          }
        />
      </div>
    );
  } else {
    body = <Panel>Checking your code…</Panel>;
  }

  return <PageMain narrow={!wide} className="pt-8">{body}</PageMain>;
}
