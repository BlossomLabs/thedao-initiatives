import { useRound, useVoteBase } from "~/lib/vote-round";
import { ballotStorageKey } from "../../../shared/vote/keys";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { bytesToHex, type Hex } from "viem";
import PageMain from "~/components/layout/PageMain";
import { Button, LinkButton } from "~/components/ui/Button";
import TierBallot, { type BallotItem, TIER_LABELS } from "~/components/vote/TierBallot";
import { BallotSkeleton, SeenSkeleton } from "~/components/vote/VoteSkeleton";
import BallotStatus, { type SendRoute } from "~/components/vote/BallotStatus";
import BallotMeter from "~/components/vote/BallotMeter";
import RoundBox, { badgeLine, RoundDeadline } from "~/components/vote/RoundBox";
import { chainNow, roundSteps } from "~/components/vote/round-steps";
import { AddressAvatar, Avatar } from "~/components/wallet/Avatar";
import { avatarSrc } from "~/lib/avatar";
import { PRIVATE_BADGE_AVATAR } from "@shared/profile";
import {
  isMockKind,
  MOCK_NOW,
  type MockKind,
  mockRound,
  MOCKS,
  useMockCards,
} from "~/components/vote/mock-round";
import MockNav from "./MockNav";
import { glowBadge } from "~/lib/badge-glow";
import VoteClosed from "~/components/vote/VoteClosed";
import { ArrowUpRight } from "lucide-react";
import { useSession } from "~/context/session";
import { useWallet } from "~/context/wallet";
import { useWalletPicker } from "~/context/wallet-picker";
import { useBoard } from "~/hooks/use-board";
import { useBadgeRatings, useMyBadges, useVoteRound } from "~/hooks/use-vote";
import { useBallotSubmit } from "~/hooks/use-vote-send";
import { errorMessage } from "~/lib/api";
import { countedTiers, lockedLabels } from "~/lib/vote-locks";
import { prefillFromRatings, ratingsToken, skipsFromRatings } from "~/lib/vote-prefill";
import { explainBelow, ruleMessage, ruleStatus } from "~/lib/vote-rules-copy";
import { useReviewIdentity } from "~/hooks/use-admin-ratings";
import BallotRules from "~/components/vote/BallotRules";
import BallotMenu from "~/components/vote/BallotMenu";
import { setVoteClock, voteNow, When } from "~/components/vote/When";
import { useMockBallotSubmit } from "~/components/vote/mock-send";
import { checkBallot, emptyTierErrors } from "../../../shared/vote/rules";
import { shortDay, usd } from "~/lib/format";
import {
  emptyIntermediateTiers,
  encodeBallot,
  encodeBallotForSend,
  freshDraft,
  sendableTiers,
  type Tier,
  tierName,
} from "../../../shared/vote/ballot";
import { rulesRound, type VoteManifest } from "../../../shared/vote/manifest";
import { poolName, PoolNote } from "~/components/vote/pool";
import { askOf, servedAsks, withdrawnProjects } from "~/lib/vote-results";

const closed = (m: VoteManifest) => voteNow() / 1000 >= m.closesAt;
const notOpenYet = (m: VoteManifest) => voteNow() / 1000 < m.opensAt;
const REAL = (m: VoteManifest) => m.kind === "real";
const microUsd = (v: string) => Number(BigInt(v) / 10_000n) / 100;
/** The shake on why a ballot can't be sent (app.css), none with reduced motion. */
const NUDGE = "motion-safe:animate-reason-nudge";
/** Why Send waits while the round came without the chain's asks. */
const ASKS_PENDING = "The asks are being worked out; try again in a minute.";
const closeTextOf = (m: VoteManifest) => <When at={m.closesAt} />;

const tiersKey = (n: number, m: VoteManifest) => ballotStorageKey("tiers", m, n);
function loadTiers(n: number, m: VoteManifest): Partial<Record<string, Tier>> {
  try {
    return JSON.parse(localStorage.getItem(tiersKey(n, m)) ?? "{}");
  } catch {
    return {};
  }
}

/** What this voter skipped on badge n's ballot: this browser only, never sent (a skipped
 * initiative is as unranked as the list). */
const skippedKey = (n: number, m: VoteManifest) => ballotStorageKey("skipped", m, n);
/** No skips saved for badge n in this browser yet (not even an empty list). */
function skipsUnset(n: number, m: VoteManifest): boolean {
  try {
    return localStorage.getItem(skippedKey(n, m)) === null;
  } catch {
    return false;
  }
}
function loadSkipped(n: number, m: VoteManifest): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(skippedKey(n, m)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
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

const BLOSSOM = "https://blossom.software/budgeting";

/** The page behind /vote/ballot and /vote/mock/:id (both routes render it: a route
 * module's own default export only gets the router's props): the ballot of the signed-in
 * account's badge, or an example's. */
export default function VotePage(
  { mockId }: {
    /** An example ballot (/vote/mock/:id): one of the mocks, nothing sent. */
    mockId?: string;
  } = {},
) {
  const myBallot = mockId === undefined;
  const { session, signOut, restoring } = useSession();
  const { address } = useWallet();
  const { openWalletPicker } = useWalletPicker();
  const board = useBoard();
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
  const info = byAccount;

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

  const ROUND = useRound();
  const voteBase = useVoteBase();
  const R = mockData?.round ?? ROUND;
  const found = info.data === "none" ? undefined : info.data;
  const data = mock ? { n: 1, claimed: true, owner: "0x0" } as const : found;
  const n = data ? data.n : null;
  const owner = data ? data.owner : null;
  const mine = mock || Boolean(me && owner && owner.toLowerCase() === me.toLowerCase());
  const realFlow = useBallotSubmit(mine && n !== null && !mock ? BigInt(n) : null);
  // An example's Send goes through the same steps, signing and sending nothing; once it
  // "lands", the example counts that ballot.
  const [mockSent, setMockSent] = useState<Hex>();
  const mockFlow = useMockBallotSubmit(setMockSent);
  const ballotFlow = mock ? mockFlow : realFlow;
  // A send that ends counted, seen here from start to end: the badge mark in the top bar
  // glows (and the Counted stamp presses down, BallotStatus). Not for a page that opens
  // on a ballot already counted.
  const lastPhase = useRef(ballotFlow.phase.kind);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = ballotFlow.phase.kind;
    if (ballotFlow.phase.kind === "counted" && was !== "counted" && was !== "idle") {
      glowBadge();
    }
  }, [ballotFlow.phase.kind]);
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
  useEffect(() => {
    if (!mock && rv) realFlow.confirm?.(rv);
  }, [mock, rv, realFlow.confirm]);

  // Withdrawn by an admin (at the round's head; once closed, the last settlement's): never
  // placed, left out of the open tiers when sent, marked on the ballot. A body served
  // before withdrawals has none.
  const withdrawnList = rv?.live.withdrawn;
  const roundTiers = rv?.tiers;
  const withdrawn = useMemo<ReadonlySet<string>>(
    () => new Set(roundTiers ? withdrawnProjects(roundTiers, withdrawnList) : []),
    [roundTiers, withdrawnList],
  );
  // The contract's raw flags (a settled project's too): what the size rule counts at $0.
  const flagList = rv?.withdrawnFlags ?? withdrawnList;
  const flagged = useMemo<ReadonlySet<string>>(() => new Set(flagList ?? []), [flagList]);
  const [tiers, setTiers] = useState<Partial<Record<string, Tier>>>({});
  // A mock starts from nothing (or its ratings) and keeps nothing in this browser.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const mockPrefilled = useRef<MockKind | null>(null);
  useEffect(() => {
    if (n === null) return;
    setTiers(mock ? {} : loadTiers(n, R));
    setSkipped(mock ? new Set() : loadSkipped(n, R));
    // Each visit to a mock starts it over, its prefill too.
    mockPrefilled.current = null;
  }, [n, mock, mockKind, R.kind, R.chainId, R.contract]);
  const setSkip = (slug: string, skip: boolean) => {
    setSkipped((prev) => {
      if (prev.has(slug) === skip) return prev;
      const next = new Set(prev);
      if (skip) next.add(slug);
      else next.delete(slug);
      try {
        if (n !== null && !mock) localStorage.setItem(skippedKey(n, R), JSON.stringify([...next]));
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
        if (n !== null && !mock) localStorage.setItem(skippedKey(n, R), JSON.stringify(slugs));
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
        if (n !== null && !mock) localStorage.setItem(tiersKey(n, R), JSON.stringify(next));
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
    Object.keys(loadTiers(n, R)).length === 0;
  // Skips are this browser's own: a ballot already sent (S-Tier settled, another device)
  // still gets its 1–2★ skipped the first time it's shown here.
  const noSkips = Boolean(rv) && n !== null && !mock && skipsUnset(n, R);
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
      // A withdrawn initiative is never placed, whatever its rating.
      setTiers((prev) =>
        Object.keys(prev).length ? prev : freshDraft(prefillFromRatings(mine, R.slugs), withdrawn)
      );
    }
    // A skip never hides what a tier holds (the tier wins on the ballot anyway).
    if (noSkips) prefillSkips(skipsFromRatings(mine, R.slugs));
    // `withdrawn` too: `fresh` waits for the round, so it is the round's when this runs.
  }, [fresh, noSkips, ratings.data, board.data, withdrawn]);

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
      if (n !== null && !mock) localStorage.setItem(tiersKey(n, R), JSON.stringify(next));
    } catch { /* storage unavailable */ }
  };

  // Each initiative's ask is the chain's, served with the round: none while it's unknown
  // (or served short).
  const asks = servedAsks(R, rv?.asks);
  const items = useMemo<BallotItem[]>(() => {
    const cards = new Map(board.data?.cards.map((c) => [c.initiative.slug, c]));
    return R.slugs.map((slug) => {
      const card = cards.get(slug);
      return { slug, title: card?.initiative.title ?? slug, card, askUsd: askOf(R, asks, slug) };
    });
  }, [board.data, R, asks]);

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
  const ballotAvatar = mock
    ? <Avatar src={PRIVATE_BADGE_AVATAR} size={48} />
    : me
    ? <AddressAvatar address={me} size={48} />
    : <Avatar src={avatarSrc(`badge-${n}`)} size={48} />;

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
    avatar: ballotAvatar,
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
    // Marked on the ballot (once closed, the last settlement's).
    withdrawn,
  };
  let body: React.ReactNode;
  let wide = false;
  if (myBallot && !mock && !me && !restoring) {
    body = (
      <Panel>
        <Headline>Sign in to see your ballot.</Headline>
        <p>
          {REAL(R)
            ? "Use the wallet that holds your TheDAO voting badge."
            : "Use the wallet an admin gave your test badge to."}
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
          Test badges are given by an admin. Ask for one, or sign in with the account that has
          yours.
        </p>
        <Button className="mt-4" onClick={() => void signOut()}>Sign out</Button>
      </Panel>
    );
  } else if (info.isPending && !mock) {
    wide = true;
    body = ballotSkeleton;
  } else if (mock && !mockData) {
    wide = true;
    body = ballotSkeleton;
  } else if (info.isError && !mock) {
    body = (
      <Panel>
        <p>
          We couldn't find your badge right now. {errorMessage(info.error)}
        </p>
        <Button className="mt-4" onClick={() => info.refetch()}>Try again</Button>
      </Panel>
    );
  } else if (data && mine && n !== null && !mock && roundQ.isPending) {
    // Whether there is a ballot that counts depends on the round: hold this URL's skeleton.
    wide = true;
    body = ballotSkeleton;
  } else if (data && mine && n !== null && (rv ? rv.closed : closed(R))) {
    // Closed once the chain says so: the server's replay, at its newest block.
    // Two tier tables side by side: this badge's ballot and the vote's result.
    wide = true;
    body = (
      <>
        {picker}
        {closedProps && (
          <VoteClosed
            {...closedProps}
            // The ballot that counted, as the round view has it; else read from the chain.
            sent={closedProps.sent ??
              (countedNow ? countedTiers(countedNow, tiers, R.slugs) : undefined)}
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
      void ballotFlow.selfSend(BigInt(n), bytesToHex(encodeBallotForSend(R.slugs, toSend)));
    };
    const counted = rv ? Boolean(rv.accepted[String(n)]) : true;
    // The round as of the newest block the server judged it at, not this browser's clock.
    const at = chainNow(voteNow() / 1000, rv?.head);
    const registrationOver = rv?.registrationClosesAt != null && at >= rv.registrationClosesAt;
    const shut = !counted && registrationOver;
    // No ballot for it (below): a narrow page, like the other notices.
    if (shut) wide = false;
    const early = (rv ? at < R.opensAt : notOpenYet(R)) || shut;
    // What the server compares is the voter's own groups of equal rank, so lock from
    // the ballot that counts.
    const settledCount = rv?.tiers.filter((t) => t.status === "settled").length ?? 0;
    const countedHex = rv?.accepted[String(n)];
    const locked = countedHex
      ? lockedLabels(countedTiers(countedHex, tiers, R.slugs), settledCount)
      : new Set<Tier>();
    // What Send sends: the ballot without the withdrawn initiatives in its open tiers (the
    // ranks below move up); in a settled tier they stay, as the lock needs.
    const toSend = sendableTiers(tiers, withdrawn, locked);
    const sending = Object.keys(toSend).length;
    const hexOf = (t: Partial<Record<string, Tier>>) =>
      bytesToHex(encodeBallot(R.slugs, t)).toLowerCase();
    // The draft is the ballot that counts, withdrawn initiatives and all: it still counts
    // (a ballot is as valid after a withdrawal as before), so the drop alone neither
    // breaks a rule nor calls for a resend.
    const asCounted = emptyIntermediateTiers(tiers).length === 0 && Boolean(countedHex) &&
      countedHex!.toLowerCase() === hexOf(tiers);
    /** What a resend would leave out: withdrawn initiatives in its open tiers. */
    const leftOut = Object.keys(tiers).filter((slug) => tiers[slug] && !toSend[slug]);
    // What this badge has paid in the settled tiers, for good, and what is left.
    const settledTiers = rv?.tiers.flatMap((t) => t.status === "settled" ? [t] : []) ?? [];
    const paidHere = (t: (typeof settledTiers)[number]) =>
      Object.entries(t.paid?.[String(n)] ?? {}).map(([slug, v]) => [slug, microUsd(v)] as const);
    const paid = new Map(settledTiers.flatMap(paidHere));
    const funded = new Set(settledTiers.flatMap((t) => t.funded));
    const refused = rv?.rejected.find((r) =>
      r.tokenId === String(n) && ballotFlow.last && BigInt(r.nonce) === ballotFlow.last.nonce
    );
    // The ballot's ask as a share of all non-withdrawn initiatives' current asks,
    // including the settled tiers' part of it. Counted on the chain's asks;
    // while they're being worked out, no amount at all.
    const poolNow = Number(BigInt(rv?.poolUsd ?? R.poolUsd) / 1_000_000n);
    // A withdrawn initiative asks $0 for the ballot's size, as the rules count it.
    const askIn = asks &&
      ((slugs: string[]) =>
        slugs.reduce((a, slug) => a + (flagged.has(slug) ? 0 : askOf(R, asks, slug) ?? 0), 0));
    const asked = askIn?.(Object.keys(toSend).filter((slug) => toSend[slug]));
    const voters = rv ? Object.keys(rv.accepted).length : 0;
    const share = rv?.share ? microUsd(rv.share) : voters > 0 ? poolNow / voters : undefined;
    // The ballot rules (rounds deployed with them), with the pool on-chain now. Checked
    // from the first pick (and before it, for the ballot box's line); refusals only once
    // something is placed.
    const rulesFor = asks &&
      rulesRound(
        R,
        asks.map(BigInt),
        BigInt(rv?.poolUsd ?? R.poolUsd),
        R.slugs.flatMap((slug, i) => flagged.has(slug) ? [i] : []),
      );
    const rules = rulesFor && R.ballotRules
      ? checkBallot(encodeBallot(R.slugs, toSend), rulesFor)
      : null;
    // The rules count the chain's asks: without them (the round not loaded yet, or served
    // without asks) nothing can be judged, or sent, relayed or from the wallet.
    const asksPending = Boolean(R.ballotRules && !asks);
    // An enforced tier left empty: the bytes would read the next one in its place.
    const empty = emptyTierErrors(toSend, R.ballotRules ? R.independentTiers : 0);
    const allErrors = asCounted
      ? []
      : empty.length
      ? [...empty, ...(rules?.errors.filter((e) => e.rule === "size") ?? [])]
      : rules?.errors ?? [];
    const errors = placed > 0 ? allErrors : [];
    const broken = errors.length > 0 || asksPending;
    // Valid a moment ago, not now (a pick broke a rule): shake why, once it's on screen.
    const invalid = allErrors.length > 0;
    if (wasInvalid.current === false && invalid) setTimeout(() => showWhyNot(false));
    wasInvalid.current = invalid;
    // A pasted ballot replaces the draft; the settled tiers stay as they were counted.
    const applyPasted = (pasted: Partial<Record<string, Tier>>): boolean => {
      // A withdrawn initiative can't be placed: a paste leaves it out (the settled tiers
      // come back from the ballot that counts below, withdrawn ones and all).
      const next = freshDraft(pasted, withdrawn);
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
          avatar={ballotAvatar}
          asked={asked}
          target={askIn?.(R.slugs) ?? 0}
          pool={poolNow}
          share={share}
          shareFinal={registrationOver}
          status={asksPending
            ? { ok: false, text: ASKS_PENDING }
            : R.ballotRules
            ? ruleStatus(allErrors)
            : undefined}
          settled={settledTiers.map((t) => {
            const fromBallot = t.funded.filter((slug) => tiers[slug] === t.tier);
            const held = Object.keys(tiers).filter((slug) => tiers[slug] === t.tier);
            return {
              tier: t.tier,
              funded: fromBallot.length,
              fundedAsk: askIn?.(fromBallot) ?? 0,
              waitingAsk: askIn?.(held.filter((slug) => !t.funded.includes(slug))) ?? 0,
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
    // The ballot that counts holds initiatives withdrawn since: it still counts, quietly.
    const names = leftOut.map((slug) => titles.get(slug) ?? slug);
    const list = names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names[0];
    const withdrawnNote = asCounted && leftOut.length > 0 && (
      <p className="m-0 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-[13.5px] leading-snug text-white/70">
        {list} {leftOut.length === 1 ? "was" : "were"}{" "}
        withdrawn from the vote; your ballot still counts, and {list}{" "}
        will be left out if you resend.
      </p>
    );
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
          now: at,
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
          The {poolName(R, poolNow)} is split equally among the badges that vote.
        </p>
        <PoolNote R={R} />
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
    const upToDateNow = asCounted ||
      (emptyIntermediateTiers(toSend).length === 0 && Boolean(countedHex) &&
        countedHex!.toLowerCase() === hexOf(toSend));
    // The sheet has something to say whatever the ballot: a send running, its outcome.
    const sheetNews = busy || upToDateNow || phaseKind === "recorded" || phaseKind === "failed" ||
      phaseKind === "rejected" || phaseKind === "late" ||
      (phaseKind === "idle" && Boolean(ballotFlow.phase.note));
    const canSend = !busy && sending > 0 && !broken;
    const summary = !sheetNews && (
      <div>
        <ul className="m-0 list-none divide-y divide-white/[.08] rounded-[14px] border border-white/10 bg-white/[.04] p-0">
          {TIER_LABELS.map((t) => {
            const inTier = Object.keys(toSend).filter((slug) => toSend[slug] === t.tier);
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
                {askIn && <span className="text-[14px] text-white tnum">{usd(askIn(inTier))}</span>}
              </li>
            );
          })}
          <li className="flex items-baseline gap-2 px-3.5 py-3">
            <span className="flex-1 text-[13px] text-white/65">Asked in all</span>
            {asked !== undefined && <b className="text-[15px] text-white tnum">{usd(asked)}</b>}
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
          : phaseKind === "recorded"
          ? "Awaiting tally…"
          : phaseKind === "rejected"
          ? "Review ballot"
          : upToDateNow
          ? "Counted"
          : countedHex
          ? R.kind === "real" ? "Resubmit ballot" : "Resubmit test ballot"
          : R.kind === "real"
          ? "Submit ballot"
          : "Submit test ballot",
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
    const upToDate = upToDateNow;
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
            asks,
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
          <LinkButton variant="primary" to={voteBase}>
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
            The {poolName(R, poolNow)} is split equally among the badges that vote.
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
          notice={rulesBox || withdrawnNote || undefined}
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
          withdrawn={withdrawn}
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
              {locked.size === 3 && settledCount < 3 && (
                <p>
                  An earlier tier settled empty on this ballot. Later tiers cannot be added in this
                  round.
                </p>
              )}
              <BallotStatus
                phase={ballotFlow.phase}
                route={sendRoute}
                chain={REAL(R) ? "Ethereum" : "Sepolia"}
                upToDate={upToDate}
                onSeeBallot={() => showEditor(false)}
                onBlocked={showWhyNot}
                canSend={!busy && sending > 0 && !broken}
                // Not ready, it stays as it is, disabled: the ballot box's line says what
                // the ballot still needs. With a ballot that counts already, it's a resend.
                sendLabel={countedHex
                  ? R.kind === "real" ? "Resubmit ballot" : "Resubmit test ballot"
                  : R.kind === "real"
                  ? "Submit ballot"
                  : "Submit test ballot"}
                resultsHref={voteBase}
                onSend={() => {
                  if (broken) return;
                  setSendRoute("relay");
                  void ballotFlow.submit(
                    BigInt(n),
                    bytesToHex(encodeBallotForSend(R.slugs, toSend)),
                  );
                }}
                onSelfSend={sendYourself}
                onRetry={() => {
                  if (!broken) void ballotFlow.retry();
                }}
              />
            </div>
          )}
        />
      </div>
    );
  } else {
    wide = true;
    body = ballotSkeleton;
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
