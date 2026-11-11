# The vote: from the Devcon demo to TheDAO's badge-holder vote

Date: 2026-11-11. Builds on `2026-11-02-devcon-voting-design.md` (the Devcon demo vote, now over).

## Intent

The Devcon demo vote proved the whole loop: a tier ballot (S / A / B), signed by the voter, relayed
on-chain by the site, tallied with Blossom Budgeting, and shown live on a results page. TheDAO now
wants that same loop for its real vote. "Devcon" goes away as a name and as a one-off; what it built
becomes **the vote**.

There are two kinds of round, and only one round runs at a time:

- **Test rounds**, run before the real vote, work exactly like Devcon did: paper codes, a welcome
  page that mints a test badge, then the ballot. They are how the team rehearses the real thing.
- **The real round**: only holders of TheDAO's **private voting badge** vote, the mainnet NFT the
  site already uses for reviewers (`REVIEW_BADGE_CONTRACT`,
  `0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C`, `chain.hasVotingBadge`). Not the public ETHSecurity
  badge (`BADGE_CONTRACT`) behind the gold avatar mark: that one must never give a ballot.

## Goals

1. Remove "Devcon" from the repo: routes, components, hooks, API, shared code, scripts, KV keys, env
   names, copy. Everything becomes "vote".
2. One ballot page serves both kinds of round. Only how you prove you may vote differs: a paper code
   (test) or holding a voting badge (real).
3. Signed-in voting-badge holders get a **Vote** item in the user menu
   (`app/components/wallet/ConnectButton.tsx`, next to "My initiatives") that goes straight to their
   ballot. Nobody else sees it. A holder of several voting badges has one ballot per badge (the
   contract counts one vote per NFT ID).
4. **Live result**:
   - Real round: the front page (`/`) _is_ the results while voting is open, for everyone: the board
     limited to the round's initiatives, each card with its gold "from the vote" share, the hero
     with the total and the countdown. This is today's `app/routes/devcon.tsx`, moved onto the front
     page.
   - Test round: the front page stays the normal board. The results lives at `/vote` and only people
     who can vote in that round see it (holders of one of the round's test badges, plus admins).
     Everyone else gets a short "This page is for voters" panel with a sign-in button.
5. **After the close**, the ballot page shows "Voting has closed" and the ballot the badge sent,
   read from the chain (any device), as `VoteClosed.tsx` does today. Unclaimed codes say voting has
   closed instead of offering a badge.

## Non-goals

- Keeping `/devcon` links working. No redirects; the Devcon round is over. _(My call.)_
- Running two rounds at once, or a history of past rounds on the site.
- Changing the contracts in `vote/`. External-NFT mode already exists (`SignedBallots` constructor
  `externalNFT`).

## Anti-goals

- Anyone without the private voting badge being able to send a ballot in the real round, through the
  UI or the API. The contract enforces `ownerOf` on the badge contract; the API must refuse early
  too, and the UI must not offer it.
- The public ETHSecurity badge counting as a voting badge anywhere.
- A test round's live result showing on the public front page.
- Paper-code endpoints (claim, code lookup, gas drip) being reachable in the real round.

## How it works

### The round manifest

Today `shared/devcon/manifest-data.ts` (written by the deploy script) describes the Devcon round. It
becomes `shared/vote/manifest-data.ts`, with one new field:

```ts
type VoteManifest = {
  kind: "test" | "real";
  chainId: number; // 11155111 for test rounds, 1 for the real round
  contract: `0x${string}`; // SignedBallots
  deployBlock: number;
  opensAt: number;
  closesAt: number;
  poolUsd: string;
  issuer?: `0x${string}`; // paper-code signer: test rounds only
  badge?: `0x${string}`; // real round: REVIEW_BADGE_CONTRACT (the contract's eligibilityNFT)
  slugs: string[];
};
```

The site decides everything from `kind`: which entry (codes or badge), where the results lives,
whether claim and drip exist. An all-zero `contract` still means "no round" (the API answers 503
`off`, the menu item and `/vote` hide).

**Chain.** `SignedBallots` in external-NFT mode reads `ownerOf` on the badge contract, so the real
round's ballots contract is on **mainnet**, where the voting badge is. Test rounds stay on Sepolia.
Chain-specific code (`use-sepolia.ts`, the `SEPOLIA_CHAIN_ID` constant, the public client in
`use-devcon.ts`, the API chain service) takes the chain from the manifest. Relaying on mainnet costs
real ETH; the relayer pays, as on Sepolia. "Send it yourself" stays as the fallback; the **gas drip
is test-only**.

### Routes

| Path           | Test round                                                       | Real round                                               |
| -------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `/`            | normal board                                                     | results while open; final result after close (see below) |
| `/vote`        | results, voters and admins only                                  | redirect to `/`                                          |
| `/vote/:code`  | paper code: welcome → mint → ballot (today's `/devcon/:code`)    | "Voting uses the TheDAO badge" panel, no claim           |
| `/vote/ballot` | the signed-in account's test badge (today's `/devcon/my-ballot`) | the signed-in account's voting badge(s)                  |

With several voting badges, `/vote/ballot` shows a small picker ("Badge #12", "Badge #40") above the
ballot; `?badge=<id>` selects one. _(My call.)_

After the real round closes, the front page keeps showing the final result until the deploy is
changed back to `contract: 0x0…`. _(My call: simplest; it is one manifest edit to return to the
normal board.)_

### API (`/api/vote`, today's `/api/devcon`)

- `GET /code/:code`, `POST /claim`, `POST /gas`: test rounds only; 404 `off` in the real round.
- `GET /mine`: the signed-in account's badge IDs in this round, now a list: `{ ids: number[] }`.
  Test: Transfer logs on the round contract (today's `badgeOf`). Real: the voting badge's token IDs
  for that address. The reviewer code already finds them (`api/chain/reviewer.ts`, via the explorer
  API); reuse it rather than scanning mainnet logs.
- `POST /ballot`: unchanged checks (valid bytes, signature by the badge's current owner, consecutive
  nonce, relay cap). In the real round, `ownerOf` is read from the badge contract. Open/closed as
  today.
- `GET /ballots`: unchanged; the results and the closed view both use it.
- `GET /visible` (new, or folded into `/mine`): whether the signed-in account may see the test
  results (holds a round badge, or is admin).

KV keys move from `["devcon", …]` to `["vote", …]`. The per-round records stay under the contract
address, as today. Env: `DEVCON_RELAYER_KEY` → `VOTE_RELAYER_KEY`, `DEVCON_ISSUER_KEY` →
`VOTE_ISSUER_KEY`; one relayer key per environment, used for whichever round is deployed. The deploy
secrets on Deno Deploy must be renamed in the same release.

### Client

- `app/components/devcon/*` → `app/components/vote/*`; `DevconPage` → `VotePage`; hooks `use-devcon`
  → `use-vote`; `devcon-flow`, `devcon-local` likewise. Copy drops "Devcon 8" and "Devcon badge";
  test rounds say "Test vote · Badge #n", the real round says "TheDAO vote · Badge #n". The welcome
  page keeps its Devcon-era wording minus the event name, and the "for a day" line goes.
- The Vote menu item: shown when there is a real round and the session holds a voting badge
  (`/api/vote/mine` non-empty), or a test round and the account has a round badge. Hidden when no
  round is deployed.
- `shared/devcon/*` → `shared/vote/*`; board components import `Tier` from there.

### Scripts

`scripts/devcon-deploy.ts` → `scripts/vote-deploy.ts` with a `--real` flag: deploys with
`externalNFT = REVIEW_BADGE_CONTRACT` on mainnet, no issuer, and writes `kind: "real"`. Without it,
today's Sepolia test round. `devcon-codes` → `vote-codes` (test only). The `devcon-codes/` output
folder and its `.gitignore` line are renamed. The uncommitted schedule changes in the deploy script
and its test are kept.

### Real-round details _(my calls)_

- **Before `opensAt`** the front page stays the normal board; the Vote menu item already shows for
  badge holders, and the ballot says when voting opens.
- **Deploy parameters**: `--real` takes no defaults. It requires the opening time, S's first tally,
  the pool in USD and a file of initiative slugs, and refuses any initiative without a real payout
  Safe (no placeholder accounts). Test rounds keep today's defaults.
- **Relay budget**: the relay cap per badge is 5 in the real round (20 in test rounds); the API
  refuses to relay when the relayer balance is below a floor and says "Send it yourself". Admin →
  Vote shows the relayer balance.
- **Rehearsal**: test rounds are the rehearsal; there is no per-environment manifest override. The
  real round's manifest goes to production in its own commit.

## Phase 2: the slow quiet ending

Voters can change their ballot until the tally that concerns it is settled. The site follows the
contract's real schedule, not a site-only close time; the manifest's `closesAt` is replaced by the
contract schedule (`opensAt`, `firstTallyAt[3]`, `initialWindow`, `maxWindows`, read from the
manifest and checked against `ScheduleConfigured`).

**The rule** is the one in `vote/docs/quiet-ending-rules.md` as of 11 November 2026 (`run_on_time`
with `between`, in `vote/reference/quiet_ending_steps.py`): tiers settle one at a time; a window has
an opening tally, a tally after every block holding a tally event, and a closing tally; the compared
outcome is the settling tier's funded set only; any differing tally extends (windows halve, up to
`maxWindows`); settle with the closing tally; forced settle after the last window. Registration
closes at S's first tally + the initial window; after it only badges with an accepted ballot may
revise. No supporter lock (still undecided in the rules).

**Replay** is ported to TypeScript (`shared/vote/quiet-ending.ts`) and checked against the Python on
shared fixtures. The server replays (it needs project balances at every event block, internal
transfers included: an archive RPC with traces, a new config value) and serves the derived state:
per tier `waiting | settling (window k, ends at) | settled (funded set, awards)`, the registration
deadline, and each badge's accepted vs rejected ballots.

**UI:**

- Ballot: registration countdown before S; "S is settling: window k of N, ends T" and whether S is
  still quiet; settled tiers locked and showing what they funded; lower tiers editable; the closed
  view once B settles.
- The editor refuses moving anything into or out of a settled tier; the API refuses it too (the
  contract would record it and replay reject it).
- Status: recorded, counted, or "not counted: <reason>, your earlier ballot still counts".
- Front page hero shows the stage (settled totals, the settling tier's window end and latest
  possible end, the next tier's start); cards show settled money in solid gold and the settling
  tier's "if it settled now" lighter.

**Blocked on decisions in `vote/docs`:** equal-NFT share accounting and rounding after a tier
settles (needed for A and B's money), and the archive RPC. Phase 2 can be built and tested on
fixtures before those land; it does not ship to a real round until they do.

## Left to the builder

- File-by-file order of the rename, and whether `/visible` is its own endpoint.
- The real-round "this needs the TheDAO badge" panel copy.
- How the results code is shared between `/` and `/vote`.
- Docs under `docs/superpowers/` and `comms/` that mention Devcon stay as history; they are not
  renamed.

## Ballot rules

Prefill from star ratings, the minimum ballot size, Tier-S independence by affiliation, the
contract's proof, adding projects during the vote, pabutools paste and `/vote/llms.txt`:
see [the ballot rules design](2026-11-11-ballot-rules-design.md).
