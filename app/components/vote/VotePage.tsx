import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { bytesToHex, type Hex } from "viem";
import PageMain from "~/components/layout/PageMain";
import { Button, LinkButton } from "~/components/ui/Button";
import TierBallot, { type BallotItem } from "~/components/vote/TierBallot";
import { BallotSkeleton, IntroSkeleton } from "~/components/vote/VoteSkeleton";
import { rememberMyCode } from "~/lib/vote-local";
import BallotStatus from "~/components/vote/BallotStatus";
import ShareSpent from "~/components/vote/ShareSpent";
import SettlingBox from "~/components/vote/SettlingBox";
import { AddressAvatar, Avatar } from "~/components/wallet/Avatar";
import { avatarSrc } from "~/lib/avatar";
import { spentRound } from "~/components/vote/mock-round";
import VoteClosed, { badgeKicker } from "~/components/vote/VoteClosed";
import { useSession } from "~/context/session";
import { useWallet } from "~/context/wallet";
import { useWalletPicker } from "~/context/wallet-picker";
import { useBoard } from "~/hooks/use-board";
import {
  apiCode,
  useBadgeRatings,
  useBallotSubmit,
  useMintWait,
  useMyBadges,
  useVoteCode,
  useVoteRound,
} from "~/hooks/use-vote";
import { api, errorMessage } from "~/lib/api";
import { countedTiers, lockedLabels } from "~/lib/vote-locks";
import { prefillFromRatings, ratingsToken } from "~/lib/vote-prefill";
import { ruleMessage } from "~/lib/vote-rules-copy";
import { useReviewIdentity } from "~/hooks/use-admin-ratings";
import BallotRules from "~/components/vote/BallotRules";
import PasteBallot from "~/components/vote/PasteBallot";
import { checkBallot } from "../../../shared/vote/rules";
import { usd } from "~/lib/format";
import { encodeBallot, type Tier } from "../../../shared/vote/ballot";
import { ROUND, rulesRound } from "../../../shared/vote/manifest";

const POOL = Number(BigInt(ROUND.poolUsd) / 1_000_000n);
const closed = () => Date.now() / 1000 >= ROUND.closesAt;
const notOpenYet = () => Date.now() / 1000 < ROUND.opensAt;
const REAL = () => ROUND.kind === "real";
const microUsd = (v: string) => Number(BigInt(v) / 10_000n) / 100;
const utc = (secs: number) =>
  `${
    new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(secs * 1000)
  } UTC`;
const closeText = `${
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(ROUND.closesAt * 1000)
} UTC`;

const tiersKey = (n: number) => `vote-tiers:${ROUND.contract}:${n}`;
function loadTiers(n: number): Partial<Record<string, Tier>> {
  try {
    return JSON.parse(localStorage.getItem(tiersKey(n)) ?? "{}");
  } catch {
    return {};
  }
}

/** Set once this browser has shown badge n's ballot: its loading skeleton is the ballot's. */
const ballotSeenKey = (n: number) => `vote-ballot-seen:${ROUND.contract}:${n}`;
function ballotSeen(code: string): boolean {
  const n = Number(code.split(".")[0]);
  if (!Number.isInteger(n)) return false;
  try {
    return localStorage.getItem(ballotSeenKey(n)) === "1";
  } catch {
    return false;
  }
}

const acceptedKey = (code: string) => `vote-accepted:${ROUND.contract}:${code}`;
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
        <p className="kicker m-0">Test vote · Demo on Sepolia</p>
        <h1 className="mt-3 font-inter-tight text-[clamp(36px,9vw,56px)] font-bold leading-[1.05] tracking-[-.03em] text-white">
          Congrats!
        </h1>
        <p className="mx-auto mt-3 max-w-[540px] font-inter-tight text-[clamp(18px,3vw,22px)] leading-snug text-white/80">
          You'll be a TheDAO <span className="text-dao-green">Badge Holder</span>{" "}
          for this test vote.
        </p>
      </header>
      <div className="shimmer shimmer-soft !my-6" />
      <Panel>
        <h2 className="k">What you'll do</h2>
        <p className="mb-4">
          TheDAO Security Fund backs initiatives that keep{" "}
          <span className="text-dao-green">Ethereum safe</span>. Its badge holders decide where the
          money goes, and for this test you're one of them.
        </p>
        <ol className="space-y-3">
          <Step n={1}>
            <b className="font-medium text-white">Claim your test badge.</b>{" "}
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
            It moves the live result as soon as it lands.
          </Step>
        </ol>
      </Panel>
      <Panel>
        <h2 className="k">How the money is split</h2>
        <p>
          A <b className="font-medium text-white">{usd(POOL)}</b>{" "}
          demo pool is split equally among voters. The ballots fund whole initiatives, highest tiers
          first, using Blossom Budgeting.
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
          {busy ? "One moment…" : "Claim my test badge"}
        </Button>
        {note && <div className="mt-4 text-left">{note}</div>}
      </div>
    </div>
  );
}

/** The page behind /vote/:code and /vote/ballot (both routes render it: a
 * route module's own default export only gets the router's props). The ballot of a
 * paper code, or with `myBallot`, of the signed-in
 * account's badge (/vote/ballot: the way back from /vote, no code needed). */
export default function VotePage({ myBallot = false }: { myBallot?: boolean } = {}) {
  const params = useParams();
  const code = myBallot ? "" : params.code ?? "";
  const qc = useQueryClient();
  const byCode = useVoteCode(code, !myBallot && !REAL());
  const { session, signOut, restoring } = useSession();
  const { address } = useWallet();
  const { openWalletPicker } = useWalletPicker();
  const board = useBoard();
  const mint = useMintWait();
  // Ballots are signed by the connected wallet, so it has to be the signed-in one.
  const me = session && address && session.address.toLowerCase() === address.toLowerCase()
    ? session.address
    : null;
  const badges = useMyBadges(me, myBallot);
  const [sp, setSp] = useSearchParams();
  // Several badges: ?badge= picks one, else the first.
  const ids = badges.data ?? [];
  const asked = Number(sp.get("badge"));
  const chosen = ids.includes(asked) ? asked : ids[0];
  const byAccount = {
    ...badges,
    data: badges.data === undefined
      ? undefined
      : chosen === undefined
      ? "none" as const
      : { n: chosen, claimed: true, owner: me },
  };
  const info = myBallot ? byAccount : byCode;

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
  const mock = import.meta.env.DEV && sp.has("mock");
  const found = info.data === "none" ? undefined : info.data;
  const data = mock ? { n: 1, claimed: true, owner: "0x0" } as const : found;
  const n = data && data !== "bad" ? data.n : null;
  const owner = data && data !== "bad" ? data.owner : null;
  const mine = mock || Boolean(me && owner && owner.toLowerCase() === me.toLowerCase());
  const ballotFlow = useBallotSubmit(mine && n !== null ? BigInt(n) : null);
  // The quiet ending: which tiers are settling or settled, and what counts.
  const roundQ = useVoteRound(5_000, mine && n !== null);
  // Dev only: ?mock=spent is a round where S settled and spent part of this badge's share.
  const mockSpent = mock && sp.get("mock") === "spent";
  const spentMock = useMemo(
    () => import.meta.env.DEV && mockSpent ? spentRound(ROUND.slugs, ROUND.poolUsd, 1) : undefined,
    [mockSpent],
  );
  const rv = spentMock ?? roundQ.data;

  // One claim at a time: the sign-in lands in several renders, and the
  // auto-claim effect can fire again before its own state updates show.
  const claiming = useRef(false);
  const doClaim = async () => {
    if (claiming.current) return;
    claiming.current = true;
    setClaim({ kind: "busy" });
    try {
      const { hash } = await api<{ hash: Hex }>("/api/vote/claim", {
        method: "POST",
        json: { code },
      });
      await mint.wait(hash);
      await qc.invalidateQueries({ queryKey: ["vote-code", code] });
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

  const showsBallot = Boolean(data && data !== "bad" && mine && n !== null);
  // From the claim page (minting) to the ballot: start the ballot at the top.
  const showsIntro = Boolean(data && data !== "bad" && !data.claimed);
  const wasIntro = useRef(false);
  useEffect(() => {
    if (showsIntro) wasIntro.current = true;
    else if (showsBallot && wasIntro.current) {
      wasIntro.current = false;
      globalThis.scrollTo({ top: 0 });
    }
  }, [showsIntro, showsBallot]);
  useEffect(() => {
    if (!showsBallot || n === null || mock) return;
    try {
      localStorage.setItem(ballotSeenKey(n), "1");
    } catch { /* storage unavailable */ }
    if (code) rememberMyCode(code);
  }, [showsBallot, n, mock, code]);

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

  // Start from the ballot that counts when this browser has none, and keep the settled
  // tiers as they were counted: they can't change, whatever this browser last had.
  const countedNow = n !== null ? rv?.accepted[String(n)] : undefined;
  const settledNow = rv?.tiers.filter((t) => t.status === "settled").length ?? 0;
  useEffect(() => {
    if (!countedNow) return;
    setTiers((prev) => {
      const counted = countedTiers(countedNow, prev, ROUND.slugs);
      if (Object.keys(prev).length === 0) return counted;
      const frozen = lockedLabels(counted, settledNow);
      if (frozen.size === 0) return prev;
      const next: Partial<Record<string, Tier>> = Object.fromEntries(
        Object.entries(prev).filter(([, t]) => t && !frozen.has(t)),
      );
      for (const [slug, t] of Object.entries(counted)) if (t && frozen.has(t)) next[slug] = t;
      const same = Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([k, t]) => prev[k] === t);
      return same ? prev : next;
    });
  }, [countedNow, settledNow]);

  // A fresh ballot starts from this badge's own star ratings (5★ S, 4★ A, 3★ B), once
  // the round is known: never over a ballot that counts or a draft in this browser.
  const identity = useReviewIdentity();
  const fresh = Boolean(rv) && n !== null && !countedNow && !mock &&
    Object.keys(loadTiers(n)).length === 0;
  const ratings = useBadgeRatings(
    n === null ? null : ratingsToken(ROUND.kind, n, identity?.tokenIds),
    fresh,
  );
  const prefilled = useRef(false);
  useEffect(() => {
    if (!fresh || prefilled.current || !ratings.data || !board.data) return;
    prefilled.current = true;
    const slugOf = new Map(board.data.cards.map((c) => [c.initiative.id, c.initiative.slug]));
    const mine = Object.fromEntries(
      Object.entries(ratings.data).flatMap(([id, stars]) => {
        const slug = slugOf.get(id);
        return slug ? [[slug, stars]] : [];
      }),
    );
    setTiers((prev) => Object.keys(prev).length ? prev : prefillFromRatings(mine, ROUND.slugs));
  }, [fresh, ratings.data, board.data]);

  const replaceTiers = (next: Partial<Record<string, Tier>>) => {
    setTiers(next);
    try {
      if (n !== null) localStorage.setItem(tiersKey(n), JSON.stringify(next));
    } catch { /* storage unavailable */ }
  };

  const items = useMemo<BallotItem[]>(() => {
    const cards = new Map(board.data?.cards.map((c) => [c.initiative.slug, c]));
    return ROUND.slugs.map((slug) => {
      const card = cards.get(slug);
      return { slug, title: card?.initiative.title ?? slug, card };
    });
  }, [board.data]);

  // A holder of several voting badges votes once per badge: pick which one.
  const picker = myBallot && ids.length > 1 && (
    <div className="flex flex-wrap justify-center gap-2 pt-4" role="group" aria-label="Your badges">
      {ids.map((id) => (
        <Button
          key={id}
          variant={id === chosen ? "primary" : undefined}
          aria-pressed={id === chosen}
          onClick={() => setSp({ badge: String(id) }, { replace: true })}
        >
          Badge #{id}
        </Button>
      ))}
    </div>
  );

  const titles = useMemo(() => new Map(items.map((i) => [i.slug, i.title])), [items]);

  let body: React.ReactNode;
  let wide = false;
  if (!myBallot && REAL()) {
    body = (
      <Panel>
        <Headline>TheDAO's vote uses the voting badge.</Headline>
        <p>Paper codes were for test votes. Sign in with the wallet that holds your badge.</p>
        <LinkButton className="mt-4" variant="primary" to="/vote/ballot">
          Open your ballot
        </LinkButton>
      </Panel>
    );
  } else if (myBallot && !mock && !me && !restoring) {
    body = (
      <Panel>
        <Headline>Sign in to see your ballot.</Headline>
        <p>
          {REAL()
            ? "Use the wallet that holds your TheDAO voting badge."
            : "Use the wallet or email you claimed your badge with."}
        </p>
        <Button className="mt-4" onClick={openWalletPicker}>Sign in</Button>
      </Panel>
    );
  } else if (myBallot && !mock && info.data === "none" && REAL()) {
    body = (
      <Panel>
        <Headline>This account has no voting badge.</Headline>
        <p>Only TheDAO's voting badge holders vote. Sign in with the wallet that holds yours.</p>
        <Button className="mt-4" onClick={() => void signOut()}>Sign out</Button>
      </Panel>
    );
  } else if (myBallot && !mock && info.data === "none") {
    body = (
      <Panel>
        <Headline>No badge on this account.</Headline>
        <p>
          Scan the QR code on your badge to claim it, or sign in with the account you claimed it
          with.
        </p>
        <Button className="mt-4" onClick={() => void signOut()}>Sign out</Button>
      </Panel>
    );
  } else if (info.isPending && !mock) {
    wide = myBallot || ballotSeen(code);
    body = wide ? <BallotSkeleton /> : <IntroSkeleton />;
  } else if (info.isError && !mock) {
    body = (
      <Panel>
        <p>
          {myBallot
            ? "We couldn't find your badge right now."
            : "We couldn't check this code right now."} {errorMessage(info.error)}
        </p>
        <Button className="mt-4" onClick={() => info.refetch()}>Try again</Button>
      </Panel>
    );
  } else if (data === "bad") {
    body = (
      <Panel>
        <Headline>This code doesn't look right.</Headline>
        <p>
          Try scanning it again, slowly. If it still fails, ask whoever gave it to you for a new
          one.
        </p>
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
  } else if (data && !data.claimed && closed()) {
    body = <VoteClosed n={null} titles={titles} closeText={closeText} />;
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
      ? <p className="text-white/60">Minting your test badge on Sepolia…</p>
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
  } else if (data && mine && n !== null && ((closed() && !spentMock) || rv?.closed)) {
    body = (
      <>
        {picker}
        <VoteClosed
          n={n}
          titles={titles}
          closeText={closeText}
          saved={tiers}
          settled={rv?.tiers.flatMap((t) =>
            t.status === "settled" ? [{ tier: t.tier, funded: t.funded }] : []
          )}
        />
      </>
    );
  } else if (data && mine && n !== null) {
    wide = true;
    const busy = ["signing", "relaying", "waiting"].includes(ballotFlow.phase.kind);
    const placed = Object.keys(tiers).length;
    const sendYourself = () =>
      void ballotFlow.selfSend(BigInt(n), bytesToHex(encodeBallot(ROUND.slugs, tiers)));
    const counted = rv ? Boolean(rv.accepted[String(n)]) : true;
    const registrationOver = rv ? Date.now() / 1000 >= rv.registrationClosesAt : false;
    const shut = !counted && registrationOver;
    const early = notOpenYet() || shut;
    // What the server compares is the voter's own groups of equal rank, so lock from
    // the ballot that counts.
    const settledCount = rv?.tiers.filter((t) => t.status === "settled").length ?? 0;
    const countedHex = rv?.accepted[String(n)];
    const locked = countedHex
      ? lockedLabels(countedTiers(countedHex, tiers, ROUND.slugs), settledCount)
      : new Set<Tier>();
    // What this badge has paid in the settled tiers, for good, and what is left.
    const settledTiers = rv?.tiers.flatMap((t) => t.status === "settled" ? [t] : []) ?? [];
    const paidHere = (t: (typeof settledTiers)[number]) =>
      Object.entries(t.paid?.[String(n)] ?? {}).map(([slug, v]) => [slug, microUsd(v)] as const);
    const paid = new Map(settledTiers.flatMap(paidHere));
    const funded = new Set(settledTiers.flatMap((t) => t.funded));
    const refused = rv?.rejected.find((r) =>
      r.tokenId === String(n) && ballotFlow.last && BigInt(r.nonce) === ballotFlow.last.nonce
    );
    const sharePanel = rv && counted && settledTiers.length > 0 && (
      <ShareSpent
        avatar={me
          ? <AddressAvatar address={me} size={48} />
          : <Avatar src={avatarSrc(`badge-${n}`)} size={48} />}
        share={microUsd(rv.share ?? "0")}
        settled={settledTiers.map((t) => {
          const mine = paidHere(t);
          return {
            tier: t.tier,
            funded: mine.length || t.funded.length,
            paid: mine.reduce((a, [, v]) => a + v, 0),
          };
        })}
      />
    );
    const settling = rv?.tiers.flatMap((t) => t.status === "settling" ? [t] : []) ?? [];
    const aside = (sharePanel || settling.length > 0) && (
      <div className="space-y-3">
        {sharePanel}
        {settling.map((t) => (
          <SettlingBox
            key={t.tier}
            tier={t.tier}
            window={t.window}
            maxWindows={ROUND.schedule.maxWindows}
            endsAt={utc(t.windowEndsAt)}
            quiet={t.quiet}
          />
        ))}
      </div>
    );
    // A pasted ballot replaces the draft; the settled tiers stay as they were counted.
    const applyPasted = (next: Partial<Record<string, Tier>>): boolean => {
      if (!countedHex) {
        replaceTiers(next);
        return false;
      }
      const counted = countedTiers(countedHex, tiers, ROUND.slugs);
      const frozen = lockedLabels(counted, settledCount);
      const out: Partial<Record<string, Tier>> = Object.fromEntries(
        Object.entries(next).filter(([, t]) => t && !frozen.has(t)),
      );
      for (const [slug, t] of Object.entries(counted)) if (t && frozen.has(t)) out[slug] = t;
      replaceTiers(out);
      return Object.keys(out).length !== Object.keys(next).length ||
        Object.entries(out).some(([k, t]) => next[k] !== t);
    };
    // The ballot rules (rounds deployed with them), with the pool on-chain now.
    const rules = ROUND.ballotRules && placed > 0
      ? checkBallot(
        encodeBallot(ROUND.slugs, tiers),
        rulesRound(ROUND, BigInt(rv?.poolUsd ?? ROUND.poolUsd)),
      )
      : null;
    const broken = Boolean(rules && !rules.ok);
    const rulesBox = broken && (
      <BallotRules
        messages={rules!.errors.map((e) =>
          ruleMessage(
            e,
            (i) => titles.get(ROUND.slugs[i]) ?? ROUND.slugs[i],
            (g) => ROUND.groups[g],
          )
        )}
      />
    );
    const stage = rv && (
      <div className="mx-auto mt-3 max-w-[640px] space-y-1 text-[14.5px] text-white/80">
        {!counted && !registrationOver && (
          <p className="font-medium text-white">
            Vote before {utc(rv.registrationClosesAt)}, or this badge can't vote.
          </p>
        )}
        {shut && (
          <p className="font-medium text-white">Registration closed before this badge voted.</p>
        )}
      </div>
    );
    body = (
      <div className="space-y-6">
        {picker}
        <header className="pt-4 text-center">
          <p className="kicker m-0">{badgeKicker(n)}</p>
          <h1 className="mt-3 font-inter-tight text-[clamp(28px,5vw,40px)] font-bold leading-[1.1] tracking-[-.03em] text-white">
            Your ballot
          </h1>
          <p className="mx-auto mt-3 max-w-[640px] font-inter-tight text-[16px] leading-snug text-white/70">
            Put what TheDAO must fund first. Initiatives in the same tier are equal. The {usd(POOL)}
            {" "}
            {REAL() ? "pool" : "demo pool"} is split equally between every badge that votes.{" "}
            {ROUND.ballotRules &&
              "A ballot needs at least 3 unrelated projects in Tier-S and must request at least 1.5× the pool in total. "}
            Anything you leave unranked gets nothing from you; your share of it returns to TheDAO.
            Put every project you'd be glad to see funded in Tier-B: it only takes money once Tier-S
            and Tier-A are done.{" "}
            <a
              href={BLOSSOM}
              target="_blank"
              rel="noopener noreferrer"
              className="text-dao-green underline-offset-2 hover:underline"
            >
              How Blossom Budgeting works
            </a>
          </p>
          {notOpenYet() && (
            <p className="mt-3 font-medium text-white">Voting opens {utc(ROUND.opensAt)}.</p>
          )}
          {stage}
        </header>
        <TierBallot
          items={items}
          tiers={tiers}
          disabled={busy || early}
          locked={locked}
          aside={aside}
          notice={rulesBox}
          funded={settledTiers.length ? funded : undefined}
          paid={paid}
          onChange={setTier}
          onReplace={replaceTiers}
          search={{ ai: board.data?.flags?.aiSearch, aiAuto: board.data?.flags?.aiSearchAuto }}
          actions={early
            ? undefined
            : (
              <div className="space-y-3 rounded-t-2xl border-t border-white/10 bg-panel/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-10px_30px_rgba(0,0,0,.35)] backdrop-blur sm:rounded-2xl sm:border sm:bg-white/[.03] sm:p-4 sm:shadow-none sm:backdrop-blur-none">
                {refused && (
                  <p className="text-[13.5px] text-amber-200">
                    Not counted: {refused.reason === "tier_settled"
                      ? "it changed a settled tier"
                      : refused.reason === "invalid_ballot"
                      ? "it breaks the ballot rules"
                      : "registration had closed"}. Your earlier ballot still counts.
                  </p>
                )}
                <BallotStatus
                  phase={ballotFlow.phase}
                  onRetry={() => void ballotFlow.retry()}
                  selfSend={placed > 0 && <Button onClick={sendYourself}>Send it yourself</Button>}
                />
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={busy || placed === 0 || broken}
                  onClick={() =>
                    void ballotFlow.submit(
                      BigInt(n),
                      bytesToHex(encodeBallot(ROUND.slugs, tiers)),
                    )}
                >
                  {placed === 0 ? "Place at least one proposal" : "Send my ballot"}
                </Button>
                {ballotFlow.phase.kind !== "failed" && (
                  <button
                    type="button"
                    disabled={busy || placed === 0 || broken}
                    onClick={sendYourself}
                    className="w-full text-center text-[13px] text-white/55 underline underline-offset-2 disabled:opacity-40"
                  >
                    Send it yourself (from your wallet, on {REAL() ? "Ethereum" : "Sepolia"})
                  </button>
                )}
                <PasteBallot
                  slugs={ROUND.slugs}
                  titles={(slug) => titles.get(slug) ?? slug}
                  askUsd={(slug) =>
                    BigInt(ROUND.projects[ROUND.slugs.indexOf(slug)]?.askUsd ?? "0")}
                  tiers={tiers}
                  onApply={applyPasted}
                />
              </div>
            )}
        />
      </div>
    );
  } else {
    wide = myBallot || ballotSeen(code);
    body = wide ? <BallotSkeleton /> : <IntroSkeleton />;
  }

  return <PageMain narrow={!wide} className="pt-8">{body}</PageMain>;
}
