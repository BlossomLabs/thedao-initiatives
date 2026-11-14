import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { bytesToHex, type Hex } from "viem";
import PageMain from "~/components/layout/PageMain";
import { Button, LinkButton } from "~/components/ui/Button";
import TierBallot, { type BallotItem, TIER_LABELS } from "~/components/vote/TierBallot";
import { BallotSkeleton, IntroSkeleton, SeenSkeleton } from "~/components/vote/VoteSkeleton";
import { rememberMyCode } from "~/lib/vote-local";
import BallotStatus, { type SendRoute } from "~/components/vote/BallotStatus";
import BallotMeter from "~/components/vote/BallotMeter";
import RoundBox, { badgeLine, RoundDeadline } from "~/components/vote/RoundBox";
import { roundSteps } from "~/components/vote/round-steps";
import { AddressAvatar, Avatar } from "~/components/wallet/Avatar";
import { avatarSrc } from "~/lib/avatar";
import {
  isMockKind,
  MOCK_NOW,
  type MockKind,
  mockRound,
  MOCKS,
  useMockCards,
} from "~/components/vote/mock-round";
import MockNav from "./MockNav";
import VoteClosed from "~/components/vote/VoteClosed";
import { ArrowUpRight } from "lucide-react";
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
import { prefillFromRatings, ratingsToken, skipsFromRatings } from "~/lib/vote-prefill";
import { explainBelow, ruleMessage, ruleStatus } from "~/lib/vote-rules-copy";
import { useReviewIdentity } from "~/hooks/use-admin-ratings";
import BallotRules from "~/components/vote/BallotRules";
import BallotMenu from "~/components/vote/BallotMenu";
import { Deadline, setVoteClock, voteNow, When } from "~/components/vote/When";
import { useMockBallotSubmit } from "~/components/vote/mock-send";
import { checkBallot, emptyTierErrors } from "../../../shared/vote/rules";
import { shortDay, usd, usdShort } from "~/lib/format";
import { encodeBallot, type Tier, tierName } from "../../../shared/vote/ballot";
import { ROUND, rulesRound, type VoteManifest } from "../../../shared/vote/manifest";

const poolOf = (m: VoteManifest) => Number(BigInt(m.poolUsd) / 1_000_000n);
const POOL = poolOf(ROUND);
const closed = (m = ROUND) => voteNow() / 1000 >= m.closesAt;
const notOpenYet = (m = ROUND) => voteNow() / 1000 < m.opensAt;
const REAL = (m = ROUND) => m.kind === "real";
const microUsd = (v: string) => Number(BigInt(v) / 10_000n) / 100;
/** The shake on why a ballot can't be sent (app.css), none with reduced motion. */
const NUDGE = "motion-safe:animate-reason-nudge";
const closeTextOf = (m: VoteManifest) => <When at={m.closesAt} />;

const tiersKey = (n: number) => `vote-tiers:${ROUND.contract}:${n}`;
function loadTiers(n: number): Partial<Record<string, Tier>> {
  try {
    return JSON.parse(localStorage.getItem(tiersKey(n)) ?? "{}");
  } catch {
    return {};
  }
}

/** What this voter skipped on badge n's ballot: this browser only, never sent (a skipped
 * initiative is as unranked as the list). */
const skippedKey = (n: number) => `vote-skipped:${ROUND.contract}:${n}`;
/** No skips saved for badge n in this browser yet (not even an empty list). */
function skipsUnset(n: number): boolean {
  try {
    return localStorage.getItem(skippedKey(n)) === null;
  } catch {
    return false;
  }
}
function loadSkipped(n: number): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(skippedKey(n)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
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
          It's a demo: no real funds move. Voting closes <Deadline at={ROUND.closesAt} />.
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
export default function VotePage(
  { myBallot = false, mockId }: {
    myBallot?: boolean;
    /** An example ballot (/vote/mock/:id): one of the mocks, nothing sent. */
    mockId?: string;
  } = {},
) {
  const params = useParams();
  const code = myBallot || mockId !== undefined ? "" : params.code ?? "";
  const qc = useQueryClient();
  const byCode = useVoteCode(code, !myBallot && mockId === undefined && !REAL());
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

  // An example ballot: /vote/mock/<kind> for everyone, or ?mock=<kind> in dev. Each is the
  // ballot at one moment of the vote, over the board's proposals, without a code or a
  // sign-in (mock-round.ts). An unknown one opens the first.
  const mockParam = mockId ?? (import.meta.env.DEV ? sp.get("mock") : null);
  const mockKind: MockKind | null = mockParam === null
    ? null
    : isMockKind(mockParam)
    ? mockParam
    : MOCKS[0];
  const mock = mockKind !== null;
  // A mock runs the page's clock from its moment in the real round (set once per mock,
  // then it ticks on); back on the real time without one.
  const clockFor = useRef<MockKind | null | undefined>(undefined);
  if (clockFor.current !== mockKind) {
    clockFor.current = mockKind;
    setVoteClock(mockKind ? MOCK_NOW[mockKind] * 1000 : null);
  }
  // Again once mounted (React's dev run unmounts once first), and back on leaving.
  useEffect(() => {
    if (mockKind) setVoteClock(MOCK_NOW[mockKind] * 1000);
    return () => setVoteClock(null);
  }, [mockKind]);
  const mockCards = useMockCards(mock ? board.data?.cards : undefined);
  const mockData = useMemo(
    () => mockKind && mockCards ? mockRound(mockKind, mockCards, 1) : undefined,
    [mockKind, mockCards],
  );
  /** The round on this page: a dev mock's fictional one, or the real one. */
  const R = mockData?.round ?? ROUND;
  const found = info.data === "none" ? undefined : info.data;
  const data = mock ? { n: 1, claimed: true, owner: "0x0" } as const : found;
  const n = data && data !== "bad" ? data.n : null;
  const owner = data && data !== "bad" ? data.owner : null;
  const mine = mock || Boolean(me && owner && owner.toLowerCase() === me.toLowerCase());
  const realFlow = useBallotSubmit(mine && n !== null && !mock ? BigInt(n) : null);
  // An example's Send goes through the same steps, signing and sending nothing; once it
  // "lands", the example counts that ballot.
  const [mockSent, setMockSent] = useState<Hex>();
  const mockFlow = useMockBallotSubmit(setMockSent);
  const ballotFlow = mock ? mockFlow : realFlow;
  /** Who is sending the ballot in progress (or sent the last): TheDAO, or the voter. */
  const [sendRoute, setSendRoute] = useState<SendRoute>("relay");
  /** Two pages, one route: the ballot that counts (its path), and its editor (/edit).
   * A send stays in the editor; once it counts, the send panel's button leads back. */
  const location = useLocation();
  const navigate = useNavigate();
  const editing = /\/edit\/?$/.test(location.pathname);
  const pageOf = (edit: boolean) => ({
    pathname: location.pathname.replace(/\/edit\/?$/, "").replace(/\/$/, "") +
      (edit ? "/edit" : ""),
    search: location.search,
  });
  /** Between the editor and the ballot that counts: each starts at the top. */
  const showEditor = (on: boolean) => {
    navigate(pageOf(on));
    globalThis.scrollTo({ top: 0 });
  };
  /** The skeleton of the page this URL opens: the editor's, or the ballot that counts. */
  const ballotSkeleton = editing ? <BallotSkeleton /> : <SeenSkeleton />;
  /** Set below when this is the ballot's page but it has none that counts yet. */
  let toEditor = false;
  /** From a Send that can't send: shake why (the ballot box's line, and the rules box when
   * there is one); after a tap, scroll there first. */
  const showWhyNot = (scroll: boolean) => {
    const why = [...document.querySelectorAll<HTMLElement>("[data-ballot-reason]")];
    if (!why.length) return;
    const shake = () =>
      why.forEach((el) => {
        el.classList.remove(NUDGE);
        void el.offsetWidth; // restart it, if it's still running
        el.classList.add(NUDGE);
        el.addEventListener("animationend", () => el.classList.remove(NUDGE), { once: true });
      });
    // Scroll only when the first reason is off screen, or covered (the phone's send panel
    // at the bottom, the top bar): what's at its middle on screen isn't it.
    const box = why[0].getBoundingClientRect();
    const hit = document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2);
    const seen = box.top >= 0 && box.bottom <= globalThis.innerHeight && Boolean(hit) &&
      why[0].contains(hit);
    if (!scroll || seen) return shake();
    const smooth = !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    why[0].scrollIntoView?.({ behavior: smooth ? "smooth" : "auto", block: "center" });
    // Once the scroll has landed, so the shake is seen.
    setTimeout(shake, smooth ? 400 : 0);
  };
  /** Whether the ballot on screen broke a rule, last render: a valid one that breaks one
   * shakes why. */
  const wasInvalid = useRef<boolean | undefined>(undefined);
  const sentFor = useRef(mockKind);
  if (sentFor.current !== mockKind) {
    sentFor.current = mockKind;
    setMockSent(undefined);
    mockFlow.reset();
  }
  // The quiet ending: which tiers are settling or settled, and what counts.
  const roundQ = useVoteRound(5_000, mine && n !== null && !mock);
  const rv = mock
    ? mockData &&
      (mockSent && n !== null
        ? { ...mockData.view, accepted: { ...mockData.view.accepted, [String(n)]: mockSent } }
        : mockData.view)
    : roundQ.data;

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
  // A mock starts from nothing (or its ratings) and keeps nothing in this browser.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const mockPrefilled = useRef<MockKind | null>(null);
  useEffect(() => {
    if (n === null) return;
    setTiers(mock ? {} : loadTiers(n));
    setSkipped(mock ? new Set() : loadSkipped(n));
    // Each visit to a mock starts it over, its prefill too.
    mockPrefilled.current = null;
  }, [n, mock, mockKind]);
  const setSkip = (slug: string, skip: boolean) => {
    setSkipped((prev) => {
      if (prev.has(slug) === skip) return prev;
      const next = new Set(prev);
      if (skip) next.add(slug);
      else next.delete(slug);
      try {
        if (n !== null && !mock) localStorage.setItem(skippedKey(n), JSON.stringify([...next]));
      } catch { /* storage unavailable */ }
      return next;
    });
  };
  /** Skips from the badge's 1–2★ ratings, the first time this browser shows its ballot
   * (sent or not); saved even when there are none, so it happens once. */
  const prefillSkips = (slugs: string[]) => {
    setSkipped((prev) => {
      if (prev.size) return prev;
      const next = new Set(slugs);
      try {
        if (n !== null && !mock) localStorage.setItem(skippedKey(n), JSON.stringify(slugs));
      } catch { /* storage unavailable */ }
      return next;
    });
  };
  const setTier = (slug: string, tier: Tier | undefined) => {
    // Placed in a tier, it isn't skipped any more.
    if (tier) setSkip(slug, false);
    setTiers((prev) => {
      const next = { ...prev, [slug]: tier };
      if (!tier) delete next[slug];
      try {
        if (n !== null && !mock) localStorage.setItem(tiersKey(n), JSON.stringify(next));
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
      const counted = countedTiers(countedNow, prev, R.slugs);
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
  }, [countedNow, settledNow, mockKind]);

  // A fresh ballot starts from this badge's own star ratings (5★ S, 4★ A, 3★ B), once
  // the round is known: never over a ballot that counts or a draft in this browser.
  const identity = useReviewIdentity();
  const fresh = Boolean(rv) && n !== null && !countedNow && !mock &&
    Object.keys(loadTiers(n)).length === 0;
  // Skips are this browser's own: a ballot already sent (S-Tier settled, another device)
  // still gets its 1–2★ skipped the first time it's shown here.
  const noSkips = Boolean(rv) && n !== null && !mock && skipsUnset(n);
  const ratings = useBadgeRatings(
    n === null ? null : ratingsToken(R.kind, n, identity?.tokenIds),
    fresh || noSkips,
  );
  const prefilled = useRef(false);
  useEffect(() => {
    if ((!fresh && !noSkips) || prefilled.current || !ratings.data || !board.data) return;
    prefilled.current = true;
    const slugOf = new Map(board.data.cards.map((c) => [c.initiative.id, c.initiative.slug]));
    const mine = Object.fromEntries(
      Object.entries(ratings.data).flatMap(([id, stars]) => {
        const slug = slugOf.get(id);
        return slug ? [[slug, stars]] : [];
      }),
    );
    if (fresh) {
      setTiers((prev) => Object.keys(prev).length ? prev : prefillFromRatings(mine, R.slugs));
    }
    // A skip never hides what a tier holds (the tier wins on the ballot anyway).
    if (noSkips) prefillSkips(skipsFromRatings(mine, R.slugs));
  }, [fresh, noSkips, ratings.data, board.data]);

  // Dev mock: its skips, and a fresh ballot from its own ratings, once per visit.
  useEffect(() => {
    if (!mockData || mockPrefilled.current === mockKind) return;
    mockPrefilled.current = mockKind;
    const stars = mockData.ratings;
    if (stars) {
      setTiers((prev) => Object.keys(prev).length ? prev : prefillFromRatings(stars, R.slugs));
    }
    setSkipped(new Set(mockData.skipped ?? (stars ? skipsFromRatings(stars, R.slugs) : [])));
  }, [mockKind, mockData, R]);

  const replaceTiers = (next: Partial<Record<string, Tier>>) => {
    setTiers(next);
    try {
      if (n !== null && !mock) localStorage.setItem(tiersKey(n), JSON.stringify(next));
    } catch { /* storage unavailable */ }
  };

  const items = useMemo<BallotItem[]>(() => {
    const cards = new Map(board.data?.cards.map((c) => [c.initiative.slug, c]));
    return R.slugs.map((slug) => {
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

  // The ballot and the result as tier tables: the page after the close, and during the
  // vote the page a sent ballot lands on.
  const closedProps = n === null ? null : {
    n,
    round: R,
    sent: mockData?.sent,
    titles,
    closeText: closeTextOf(R),
    saved: tiers,
    settled: rv?.tiers.flatMap((t) =>
      t.status === "settled"
        ? [{
          tier: t.tier,
          funded: t.funded,
          awards: Object.fromEntries(
            Object.entries(t.awards).map(([slug, v]) => [slug, microUsd(v)]),
          ),
        }]
        : []
    ),
    poolUsd: microUsd(rv?.poolUsd ?? R.poolUsd),
    avatar: me
      ? <AddressAvatar address={me} size={48} />
      : <Avatar src={avatarSrc(`badge-${n}`)} size={48} />,
    items,
    paid: new Map(
      rv?.tiers.flatMap((t) =>
        t.status === "settled"
          ? Object.entries(t.paid?.[String(n)] ?? {}).map(([slug, v]) =>
            [slug, microUsd(v)] as const
          )
          : []
      ) ?? [],
    ),
    shareUsd: rv?.share ? microUsd(rv.share) : undefined,
  };
  let body: React.ReactNode;
  let wide = false;
  if (!myBallot && !mock && REAL(R)) {
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
          {REAL(R)
            ? "Use the wallet that holds your TheDAO voting badge."
            : "Use the wallet or email you claimed your badge with."}
        </p>
        <Button className="mt-4" onClick={openWalletPicker}>Sign in</Button>
      </Panel>
    );
  } else if (myBallot && !mock && info.data === "none" && REAL(R)) {
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
    wide = myBallot || ballotSeen(code) || editing;
    body = wide ? ballotSkeleton : <IntroSkeleton />;
  } else if (mock && !mockData) {
    wide = true;
    body = ballotSkeleton;
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
  } else if (data && !data.claimed && closed(R)) {
    body = <VoteClosed n={null} titles={titles} closeText={closeTextOf(R)} />;
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
  } else if (data && mine && n !== null && !mock && roundQ.isPending) {
    // Whether there is a ballot that counts depends on the round: hold this URL's skeleton.
    wide = true;
    body = ballotSkeleton;
  } else if (data && mine && n !== null && (closed(R) || rv?.closed)) {
    // Two tier tables side by side: this badge's ballot and the vote's result.
    wide = true;
    body = (
      <>
        {picker}
        {closedProps && (
          <VoteClosed
            {...closedProps}
            roundBox={R.schedule && <RoundBox schedule={R.schedule} rv={rv} stepsOnly />}
          />
        )}
      </>
    );
  } else if (data && mine && n !== null) {
    wide = true;
    const busy = ["signing", "relaying", "waiting"].includes(ballotFlow.phase.kind);
    const placed = Object.keys(tiers).length;
    const sendYourself = () => {
      // The contract would refuse it: never open the wallet for a ballot breaking a rule.
      if (broken) return;
      setSendRoute("own");
      void ballotFlow.selfSend(BigInt(n), bytesToHex(encodeBallot(R.slugs, tiers)));
    };
    const counted = rv ? Boolean(rv.accepted[String(n)]) : true;
    const registrationOver = rv ? voteNow() / 1000 >= rv.registrationClosesAt : false;
    const shut = !counted && registrationOver;
    // No ballot for it (below): a narrow page, like the other notices.
    if (shut) wide = false;
    const early = notOpenYet(R) || shut;
    // What the server compares is the voter's own groups of equal rank, so lock from
    // the ballot that counts.
    const settledCount = rv?.tiers.filter((t) => t.status === "settled").length ?? 0;
    const countedHex = rv?.accepted[String(n)];
    const locked = countedHex
      ? lockedLabels(countedTiers(countedHex, tiers, R.slugs), settledCount)
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
    // The ballot's ask, on a ring full at 3× the pool (the 1.5× the rules want is half way);
    // the settled tiers' part of it.
    const poolNow = Number(BigInt(rv?.poolUsd ?? R.poolUsd) / 1_000_000n);
    const askOf = (slug: string) => microUsd(R.projects[R.slugs.indexOf(slug)]?.askUsd ?? "0");
    const asked = Object.entries(tiers).reduce((a, [slug, t]) => a + (t ? askOf(slug) : 0), 0);
    const voters = rv ? Object.keys(rv.accepted).length : 0;
    const share = rv?.share ? microUsd(rv.share) : voters > 0 ? poolNow / voters : undefined;
    // The ballot rules (rounds deployed with them), with the pool on-chain now. Checked
    // from the first pick (and before it, for the ballot box's line); refusals only once
    // something is placed.
    const rules = R.ballotRules
      ? checkBallot(
        encodeBallot(R.slugs, tiers),
        rulesRound(R, BigInt(rv?.poolUsd ?? R.poolUsd)),
      )
      : null;
    // An enforced tier left empty: the bytes would read the next one in its place.
    const empty = R.ballotRules ? emptyTierErrors(tiers, R.independentTiers) : [];
    const allErrors = empty.length
      ? [...empty, ...(rules?.errors.filter((e) => e.rule === "size") ?? [])]
      : rules?.errors ?? [];
    const errors = placed > 0 ? allErrors : [];
    const broken = errors.length > 0;
    // Valid a moment ago, not now (a pick broke a rule): shake why, once it's on screen.
    const invalid = allErrors.length > 0;
    if (wasInvalid.current === false && invalid) setTimeout(() => showWhyNot(false));
    wasInvalid.current = invalid;
    // A pasted ballot replaces the draft; the settled tiers stay as they were counted.
    const applyPasted = (next: Partial<Record<string, Tier>>): boolean => {
      if (!countedHex) {
        replaceTiers(next);
        return false;
      }
      const counted = countedTiers(countedHex, tiers, R.slugs);
      const frozen = lockedLabels(counted, settledCount);
      const out: Partial<Record<string, Tier>> = Object.fromEntries(
        Object.entries(next).filter(([, t]) => t && !frozen.has(t)),
      );
      for (const [slug, t] of Object.entries(counted)) if (t && frozen.has(t)) out[slug] = t;
      replaceTiers(out);
      return Object.keys(out).length !== Object.keys(next).length ||
        Object.entries(out).some(([k, t]) => next[k] !== t);
    };
    const meter = (compact: boolean) =>
      rv && (
        <BallotMeter
          compact={compact}
          avatar={me
            ? <AddressAvatar address={me} size={48} />
            : <Avatar src={avatarSrc(`badge-${n}`)} size={48} />}
          asked={asked}
          target={poolNow * 3}
          pool={poolNow}
          share={share}
          shareFinal={registrationOver}
          status={R.ballotRules ? ruleStatus(allErrors) : undefined}
          settled={settledTiers.map((t) => {
            const fromBallot = t.funded.filter((slug) => tiers[slug] === t.tier);
            const held = Object.keys(tiers).filter((slug) => tiers[slug] === t.tier);
            const askIn = (slugs: string[]) => slugs.reduce((a, slug) => a + askOf(slug), 0);
            return {
              tier: t.tier,
              funded: fromBallot.length,
              fundedAsk: askIn(fromBallot),
              waitingAsk: askIn(held.filter((slug) => !t.funded.includes(slug))),
              fundedUsd: fromBallot.reduce((a, slug) => a + microUsd(t.awards[slug] ?? "0"), 0),
              paid: paidHere(t).reduce((a, [, v]) => a + v, 0),
            };
          })}
          menu={!early && (
            <BallotMenu
              slugs={R.slugs}
              tiers={tiers}
              onApply={applyPasted}
            />
          )}
        />
      );
    const sharePanel = meter(false);
    // The ballot box says what's missing; this box only explains the affiliations.
    const below = errors.filter(explainBelow);
    const rulesBox = below.length > 0 && (
      <BallotRules
        messages={below.map((e) =>
          ruleMessage(
            e,
            (i) => titles.get(R.slugs[i]) ?? R.slugs[i],
            (g) => R.groups[g],
          )
        )}
      />
    );
    // Where the round is, and what this badge can still do (the stepper box).
    const lastSettled = settledTiers.at(-1);
    const roundProps = R.schedule && {
      schedule: R.schedule,
      rv,
      badge: badgeLine({
        phase: roundSteps({
          schedule: R.schedule,
          tiers: rv?.tiers,
          now: voteNow() / 1000,
          closed: rv?.closed,
        }).phase,
        counted: Boolean(rv?.accepted[String(n)]),
        shut,
        settled: settledTiers.map((t) => t.tier),
      }),
      mine: lastSettled && {
        onBallot: lastSettled.funded.filter((slug) => tiers[slug] === lastSettled.tier).length,
        paidUsd: paidHere(lastSettled).reduce((a, [, v]) => a + v, 0),
        shareUsd: share,
      },
    };
    const roundBox = roundProps && (
      <div>
        <RoundBox {...roundProps} bare />
      </div>
    );
    // On a phone: the round box and how the vote works open from the deadline in the
    // bottom bar; Send opens a sheet with the ballot about to go and the send panel.
    const howItWorks = (
      <div className="space-y-3 text-[14px] leading-snug text-white/70">
        <p className="m-0">
          The {usdShort(poolOf(R))} {REAL(R) ? "pool" : "demo pool"}{" "}
          is split equally among the badges that vote.
        </p>
        <a
          href={BLOSSOM}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm no-underline hover:no-underline"
        >
          Learn how <span className="text-dao-green">Blossom Budgeting</span> works
          <ArrowUpRight className="size-3.5 opacity-70" aria-hidden="true" />
        </a>
      </div>
    );
    const phaseKind = ballotFlow.phase.kind;
    const upToDateNow = Boolean(countedHex) &&
      countedHex!.toLowerCase() === bytesToHex(encodeBallot(R.slugs, tiers)).toLowerCase();
    // The sheet has something to say whatever the ballot: a send running, its outcome.
    const sheetNews = busy || upToDateNow || phaseKind === "failed" || phaseKind === "late" ||
      (phaseKind === "idle" && Boolean(ballotFlow.phase.note));
    const canSend = !busy && placed > 0 && !broken;
    const summary = !sheetNews && (
      <div>
        <ul className="m-0 list-none divide-y divide-white/[.08] rounded-[14px] border border-white/10 bg-white/[.04] p-0">
          {TIER_LABELS.map((t) => {
            const inTier = Object.keys(tiers).filter((slug) => tiers[slug] === t.tier);
            return (
              <li key={t.tier} className="flex items-baseline gap-2 px-3.5 py-3 text-[13px]">
                <b className="w-14 font-inter-tight text-[14px] text-[#8fd18d]">
                  {tierName(t.tier)}
                </b>
                <span className="flex-1 text-white/65">
                  {inTier.length
                    ? `${inTier.length} ${inTier.length === 1 ? "initiative" : "initiatives"}`
                    : "Empty"}
                </span>
                <span className="text-[14px] text-white tnum">
                  {usd(inTier.reduce((a, slug) => a + askOf(slug), 0))}
                </span>
              </li>
            );
          })}
          <li className="flex items-baseline gap-2 px-3.5 py-3">
            <span className="flex-1 text-[13px] text-white/65">Asked in all</span>
            <b className="text-[15px] text-white tnum">{usd(asked)}</b>
          </li>
        </ul>
        <p className="m-0 mt-3 px-0.5 text-[13.5px] leading-relaxed text-white/72">
          It’s a signature, not a payment. TheDAO sends it to {REAL(R) ? "Ethereum" : "Sepolia"}
          {" "}
          for you. You can change it and send again until each tier settles.
        </p>
      </div>
    );
    const phone = {
      head: meter(true),
      round: R.schedule
        ? <RoundDeadline schedule={R.schedule} rv={rv} badge={roundProps?.badge} />
        : <span className="text-[13px] text-white/70">How the vote works</span>,
      roundSheet: (
        <>
          {roundBox}
          {howItWorks}
        </>
      ),
      send: early ? undefined : {
        label: busy
          ? "Sending…"
          : upToDateNow
          ? "Counted"
          : countedHex
          ? "Resend my ballot"
          : "Send my ballot",
        ready: canSend || sheetNews,
        summary,
      },
      onBlocked: () => showWhyNot(true),
    };
    // On the "your ballot" page: where the round is, without the tier settling now.
    const roundStepsOnly = roundProps && <RoundBox {...roundProps} stepsOnly />;
    // A badge that never sent a ballot before S-Tier settled: there is nothing it can do
    // here, so no ballot at all. Said like an error page, then where the vote is (read
    // only) and where to follow it.
    const sSettled = rv?.tiers.find((t) => t.tier === "S" && t.status === "settled");
    // The ballot on screen is the one that counts: seen as "your ballot", with Edit.
    const upToDate = Boolean(countedHex) &&
      countedHex!.toLowerCase() === bytesToHex(encodeBallot(R.slugs, tiers)).toLowerCase();
    const seenPage = countedHex && !editing && closedProps && (
      <>
        {picker}
        <VoteClosed
          {...closedProps}
          // What counts, whatever this browser's draft has since.
          sent={countedTiers(countedHex, tiers, R.slugs)}
          roundBox={roundStepsOnly}
          live={{
            onEdit: () => showEditor(true),
            tally: rv && {
              tiers: rv.live.tiers ?? {},
              awards: Object.fromEntries(
                Object.entries(rv.live.awards).map(([slug, v]) => [slug, microUsd(v)]),
              ),
              // What this badge would pay for each, if the open tiers settled now.
              paid: Object.fromEntries(
                Object.entries(rv.live.paid?.[String(n)] ?? {}).map((
                  [slug, v],
                ) => [slug, microUsd(v)]),
              ),
            },
          }}
        />
      </>
    );
    const missedPage = shut && (
      <div className="space-y-8 pb-6 pt-10">
        {picker}
        <header className="text-center">
          <p className="m-0 font-inter-tight text-[12px] uppercase tracking-[.18em] text-white/55">
            Badge #{n} · Registration closed
          </p>
          <p
            aria-hidden="true"
            className="m-0 mt-2 font-inter-tight text-[clamp(72px,14vw,120px)] font-extrabold leading-none tracking-[-.04em] text-white/15"
          >
            404
          </p>
          <h1 className="mt-1 font-inter-tight text-[clamp(30px,5.5vw,44px)] font-bold leading-[1.08] tracking-[-.03em] text-white">
            No ballot found
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-[16px] leading-relaxed text-white/75">
            This badge didn’t send a first ballot before S-Tier settled
            {sSettled?.status === "settled" ? ` on ${shortDay(sSettled.at)}` : ""}, so it can’t vote
            this round. The vote goes on without it.
          </p>
        </header>
        {R.schedule && <RoundBox schedule={R.schedule} rv={rv} />}
        <div className="flex justify-center">
          <LinkButton variant="primary" to={REAL(R) ? "/" : "/vote"}>
            Follow the results live
          </LinkButton>
        </div>
      </div>
    );
    // No ballot that counts on the ballot's page: it's the editor's (moved there below).
    if (!missedPage && !seenPage && !editing) toEditor = true;
    body = missedPage || seenPage || (
      <div className="space-y-6 select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable=true]]:select-text">
        {picker}
        {/* On a phone it's in the sheet the round's deadline opens (TierBallot). */}
        <header className="pt-4 text-center max-sm:hidden">
          <p className="kicker m-0">What should TheDAO prioritize?</p>
          <h1 className="mt-3 font-inter-tight text-[clamp(28px,5vw,40px)] font-bold leading-[1.1] tracking-[-.03em] text-white">
            Your ballot
          </h1>
          {
            /* Two lines at most: the rules, deadlines and what unranked means are said
              where they apply (the ballot box, the round box, the list). */
          }
          <p className="mx-auto mt-3 max-w-[640px] font-inter-tight text-[16px] leading-snug text-white/70">
            The {usdShort(poolOf(R))} {REAL(R) ? "pool" : "demo pool"}{" "}
            is split equally among the badges that vote.
          </p>
          <a
            href={BLOSSOM}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm mt-4 no-underline hover:no-underline"
          >
            Learn how <span className="text-dao-green">Blossom Budgeting</span> works
            <ArrowUpRight className="size-3.5 opacity-70" aria-hidden="true" />
          </a>
        </header>
        <TierBallot
          items={items}
          tiers={tiers}
          disabled={busy || early}
          locked={locked}
          head={sharePanel}
          notice={rulesBox}
          listHead={roundBox}
          phone={phone}
          funded={settledTiers.length ? funded : undefined}
          paid={paid}
          onChange={setTier}
          onReplace={replaceTiers}
          // Once a ballot counts: changed since, Restore sent ballot brings it back.
          sent={countedHex ? countedTiers(countedHex, tiers, R.slugs) : undefined}
          skipped={skipped}
          onSkip={setSkip}
          search={{ ai: board.data?.flags?.aiSearch, aiAuto: board.data?.flags?.aiSearchAuto }}
          actions={early ? undefined : (
            // On a phone it's in the send sheet (PhoneEditor), which is its box.
            <div className="space-y-3 sm:rounded-2xl sm:border sm:border-white/10 sm:bg-white/[.03] sm:p-4">
              {refused && (
                <p className="text-[13.5px] text-amber-200">
                  Not counted: {refused.reason === "tier_settled"
                    ? "it changed a settled tier"
                    : refused.reason === "invalid_ballot"
                    ? "it breaks the ballot rules"
                    : "S-Tier had settled before this badge's first ballot"}. Your earlier ballot
                  still counts.
                </p>
              )}
              {mock && (
                <p className="text-center text-[12.5px] text-white/55">
                  An example ballot: Send goes through the steps, but nothing is signed or sent.
                </p>
              )}
              <BallotStatus
                phase={ballotFlow.phase}
                route={sendRoute}
                chain={REAL(R) ? "Ethereum" : "Sepolia"}
                upToDate={upToDate}
                onSeeBallot={() => showEditor(false)}
                onBlocked={showWhyNot}
                canSend={!busy && placed > 0 && !broken}
                // Not ready, it stays as it is, disabled: the ballot box's line says what
                // the ballot still needs. With a ballot that counts already, it's a resend.
                sendLabel={countedHex ? "Resend my ballot" : "Send my ballot"}
                resultsHref={REAL(R) ? "/" : "/vote"}
                onSend={() => {
                  setSendRoute("relay");
                  void ballotFlow.submit(BigInt(n), bytesToHex(encodeBallot(R.slugs, tiers)));
                }}
                onSelfSend={sendYourself}
                onRetry={() => void ballotFlow.retry()}
              />
            </div>
          )}
        />
      </div>
    );
  } else {
    wide = myBallot || ballotSeen(code) || editing;
    body = wide ? ballotSkeleton : <IntroSkeleton />;
  }
  // The ballot's page without a ballot that counts: on to the editor, in place.
  useEffect(() => {
    if (toEditor) navigate(pageOf(true), { replace: true });
    // pageOf follows the location, which this effect runs after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toEditor]);

  // On an example: links to the others (the ballot's and the vote results').
  const mockNav = mock && <MockNav className="mb-2" />;

  return (
    <PageMain narrow={!wide} className="pt-8">
      {mockNav}
      {body}
    </PageMain>
  );
}
