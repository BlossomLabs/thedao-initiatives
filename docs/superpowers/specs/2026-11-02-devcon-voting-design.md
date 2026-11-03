# DevCon one-day badge holders — design

Date: 2026-11-02. Devcon 8 runs 3–6 November 2026 (JIO World Centre, Mumbai). Must be live
before the doors open on 3 November.

## Intent

At Devcon we hand out paper QR codes. Whoever scans one becomes a "badge holder for a day": they
get a Sepolia voting NFT, rank the initiatives on a tiered ballot, and watch on a projector how the
pool would be split if the vote closed right now. It's a live demo of Blossom budgeting with real
initiatives and a real-looking pool, run on testnet.

Success: a stranger scans the QR on their phone, understands in one screen what's going on, signs
in with whatever they have (email or wallet), votes in under a minute, sees their ballot confirmed
on-chain, and sees the projector move.

## Goals

- `/devcon/:code`: intro → "Accept the challenge"-style button → existing sign-in modal → mint →
  ballot → confirmed receipt.
- `/devcon`: projector page, same rows/look as the homepage list, plus the vote's share as a second
  bar segment and a clear headline (what's happening, total funded by the vote).
- QR codes verifiable by the site with no database: signed by a key only the user holds.
- Ballots relayed by the server (no gas for voters), always with a "send it yourself" option.

## Non-goals

- No contract changes. `vote/contracts/SignedBallots.sol` is deployed as-is.
- No slow-quiet-ending settlement windows. One straight PB-EAR tally of the current ballots;
  result-tier chips describe the current tally, without locking any tier before closing.
- No database records for codes or claims.
- Existing TheDAO badge holders do not vote in this round. Only DevCon code holders.
- Initiatives submitted during Devcon do not join the ballot (the list freezes at opening).

## Anti-goals (it fails even if it works)

- The site or server ever holding the QR-signing private key.
- A user told "Counted" when the on-chain record is not exactly the ballot they signed.
- A voter stuck with no way forward when the relay fails (there must always be retry and self-send).
- The projector looking like a different app from the homepage.

## Decided by the user

- **Sign-in:** the existing sign-in modal (email, MetaMask, WalletConnect, …), opened only after
  the intro's call-to-action button. Before that, the page explains what this is.
- **QR codes:** generated as public-key signatures. The user holds the private key; the website
  verifies codes with the public address only. Generate 200; numbering must be open-ended so
  codes printed later (201, 202, …) work with no site change.
- **Claimed check:** a code can only be claimed once.
- **One per person:** an address that already holds a DevCon NFT cannot claim another code. Show a
  meme-style "bad kid" message, e.g. "Nice try, bad kid 😏 One badge per person." (draft 2–3
  variants; the user picks).
- **Ballot submission:** browser signs the EIP-712 `Vote`; server receives ballot + signature,
  sends the Sepolia tx, returns the tx hash. The browser watches that hash, and after mining checks
  the tx is the right one (our contract, `recordFor`, this tokenId, expected nonce, the same ballot
  bytes it signed, succeeded). Then it tells the user: counted / failed. On failure: **Retry**.
- **Self-send:** always offered as a secondary option, both when sending and when retrying: the
  user submits the same signed ballot to the contract from their own wallet.
- **Ballot UI:** the S/A/B tier widget from `../blossomlabs.eth/src/components/budgeting/voting/tier-list.tsx`
  (`TierList`, `lib/ballot-tiers.ts` `tierRanks`), restyled to this site.
- **Ballot contents:** every current initiative, not only those that qualify for the vote.
- **Projector:** at `/devcon`, the same information and layout as the homepage list
  (`app/components/board/BoardList.tsx`), the bar gets a second segment in another color for the
  vote's share, plus a headline with what is going on and the total funded by the vote.
- **Pool:** 400 ETH at today's price, fixed: 400 × $2,283.11 = **$913,244** (`poolUsd = 913_244e6`).
- **Close:** end of 6 November in Mumbai = **2026-11-06 18:29:59 UTC** (use 18:30:00 UTC as the
  boundary: ballots strictly before it count).
- **Admin:** `sem-the-bee.eth` = `0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF`. The user has
  Sepolia ETH to fund the server's sending key.

## Design (Claude's calls unless marked above)

### QR codes

- Code format: `<n>.<sig>` where `n` is a positive decimal integer and `sig` is a 65-byte
  secp256k1 signature, base64url encoded (~87 chars). URL: `https://<site>/devcon/<n>.<sig>`.
- Signed message (EIP-191 personal_sign): `TheDAO Devcon 8 badge #<n>`. The event name prevents
  reuse at a future event.
- Site config: `DEVCON_ISSUER` = the issuer's public address. Verification: recover the signer
  of the message for `n` and compare. Uses viem, available in both app and API.
- `scripts/devcon-codes.ts` (run locally by the user): reads the private key from an env var
  (`DEVCON_ISSUER_KEY`, never committed), takes `--from 1 --to 200 --base-url`, writes
  `codes.csv` (n, url) and a printable PDF of QR codes with the number under each, into a folder
  outside the repo or gitignored. The user creates the key with `cast wallet new` and puts only the
  address in config.

### Contract deployment (Sepolia)

- Internal NFT mode (`externalNFT = address(0)`). Token ID = code number `n`. "Claimed" =
  `ownerOf(n)` exists; `_safeMint` already rejects a second mint.
- Schedule: `maxWindows = 1`, `initialWindow = 1` second. `firstTallyAt = [C-1, C, C+1]` where
  C = 2026-11-06 18:30:00 UTC. Then `registrationDeadline = C` (mint and first ballots close at C),
  `hardDeadline = C+2`. `opensAt` = a few minutes after deployment, once setup is done.
  Overlap check: `T0+W ≤ T1`, `T1+W ≤ T2` hold.
- Deploy script (Foundry, in `vote/`), run with the server's sending key as the initial admin:
  1. Deploy `SignedBallots(admin = serverKey, address(0), "TheDAO Devcon 8", "DEVCON", schedule)`.
  2. `addInitiative(account, askUsd)` for every current initiative, in a fixed order. `account` =
     the initiative's Safe address if set and unique, else a deterministic placeholder
     (`address(uint160(uint256(keccak256("devcon8:" ++ slug))))`). `askUsd` = goal in 6 decimals.
  3. `setPoolUsd(913_244e6)`.
  4. Grant `DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `PLEDGE_ROLE` to sem-the-bee.eth; renounce those
     three for the server key. The server key keeps `MINTER_ROLE` (and `BLOB_SUBMITTER_ROLE` is
     unused, renounce it too).
  5. Write a manifest JSON (contract address, chain id, deploy block, initiative order: index → slug)
     committed to the repo, so app and API map ballot bytes to initiatives.
- Must finish before `opensAt`; after opening, initiatives, currencies and metadata are frozen.

### API (Hono, `api/routes/devcon.ts`)

Config: `DEVCON_ISSUER`, `DEVCON_CONTRACT`, `SEPOLIA_RPC_URL(S)`, `DEVCON_RELAYER_KEY` (server
sending key with MINTER_ROLE and Sepolia ETH).

- `GET /api/devcon/code/:code` → `{ valid, n, claimed, owner? }`. Signature check + `ownerOf`.
- `POST /api/devcon/claim` `{ code }`, requires a signed-in session (existing SIWE session;
  address = session address). Checks: valid signature, before C, `ownerOf(n)` empty,
  `balanceOf(address) == 0` (else 409 `one_per_person`). Sends `mint(address, n)`, returns tx hash.
  The browser waits for the receipt before showing the ballot.
- `POST /api/devcon/ballot` `{ tokenId, nonce, ballot (hex), signature }`. Checks owner, nonce =
  `nonceOf + 1`, ballot valid (`vote/shared/ranks.ts`), signature matches the EIP-712 digest, before
  C. Sends `recordFor(tokenId, nonce, ballot, signature)`, returns tx hash. No session needed: the
  signature is the authorization.
- `GET /api/devcon/results` → current results (see below), cached ~5 s in KV like the board.
- Relayer nonce handling: serialize sends through one queue/lease so concurrent requests don't reuse
  an account nonce.

### Pages

- `/devcon/:code`
  1. Intro: "You're a TheDAO badge holder for a day…" what the vote decides, that it is live on
     the screen, that it closes at C. Invalid code / claimed by someone else → said here, before
     sign-in. Claimed by the signed-in user → straight to their ballot.
  2. CTA button ("Accept the challenge" or similar; propose 2–3 wordings) → existing sign-in modal.
  3. Claim → mint receipt → ballot.
  4. Ballot: TierList over all initiatives in manifest order. Submit = sign EIP-712 (domain
     `BlossomBallots` v`2`, Sepolia chain id, contract) → POST → watch hash → verify → "Counted"
     with a link to `/devcon` and to the tx on Sepolia Etherscan. They can revise until C (next nonce).
  5. Failure: "Didn't go through" + Retry (resend to API) + "Send it yourself" (wallet calls
     `recordFor` with the same signature; switch to Sepolia if needed). Self-send also offered
     next to the primary Submit.
  6. After C: read-only, "Voting closed", link to results.
- `/devcon`: projector. Reuses the board list rows and bar; second segment in a distinct color
  (gold-ish, to be confirmed in the mockup) = vote's allocation. Headline: what this is, ballots so
  far, pool, total allocated by the vote, "if voting closed now", time left. Auto-refresh every
  few seconds. Same order as the homepage (no live re-sorting). After C: final result.

### Results tally

Initiatives receiving a positive vote allocation show an S-TIER, A-TIER or B-TIER chip in
both list and card layouts. The tier is the stage in which the existing PB-EAR transcript
funds the initiative: S ends at rank level 1; A ends once every ballot's second nonempty
tier has opened; B covers the remaining levels. These are the result-stage boundaries
used by `vote/reference/quiet_ending_steps.py` (`tier_levels` / `bound`), without its
settlement windows. A ballot's ranks count proposals above a tier, so they must not be
read as literal tier numbers 1/2/3. A short ballot's B choices can already contribute in
the result's A stage. Already-funded initiatives taking no DAO allocation get no tier chip.

- Ballots: replay `BallotRecorded` events from the deploy block (latest per tokenId), ignoring any
  with block timestamp ≥ C and voids from `RegistrationRevoked`.
- Costs: per initiative, `max(0, goal − raised)` from the site's live funding data (so donations
  during Devcon count). Initiatives already fully funded are skipped.
- Weights: `poolUsd / ballots` each, integer-exact, via `pbearTranscript` in `vote/shared/pbear.ts`.
  Withheld/unplaced (255) means no support.
- Vote share per initiative = its cost if funded, else 0. Projector bar: green = raised/goal,
  second color = share/goal.

### Corrections and calls from the builder check (Claude's calls)

- **Rank 0 is invalid on-chain.** `vote/shared/ranks.ts` `validate` accepts 0 but
  `_validateBallot` reverts on it. Encode unplaced as 255 (not `tierRanks`' 0) and have the API
  reject 0 explicitly before relaying.
- **Sepolia in the wallet setup.** `app/context/privy.tsx` and `app/lib/wagmi.ts` only list
  mainnet. Add Sepolia as a supported chain (mainnet stays the default for the rest of the site);
  on `/devcon/:code`, switch the wallet to Sepolia before asking for the EIP-712 signature (injected
  wallets refuse typed data for another chain), and before self-send.
- **"Counted" also needs time < C.** `hardDeadline` is C+2, so a revision can land on-chain in
  [C, C+2) and be ignored by the tally. The receipt check requires the block timestamp < C; the
  API refuses ballots at or after C.
- **Smart wallets.** Before claiming, the API checks the session address has no code on Sepolia
  and is an EOA-signing wallet; otherwise "Use email or a regular wallet for this one". (A
  mainnet-only smart wallet can't sign `recordFor` on Sepolia; `_safeMint` to a contract without
  `onERC721Received` reverts.)
- **"Every current initiative"** = every initiative listed on the homepage board at deploy time,
  regardless of vote eligibility. Fully funded ones stay on the ballot with cost 0 and are skipped
  by the tally.
- **goal and raised** = the same figures the homepage row shows (`goalUsd`, `summary.total` incl.
  pledges), so the projector's green bar matches the homepage exactly.
- **One per person** stays a per-address limit (user's decision); someone signing in with a second
  account can claim a second paper code. Accepted.
- **Relayer serialization** also covers the `balanceOf == 0` check, so two codes claimed at once by
  the same address can't both mint.

### Gas for self-send (user's decision)

- Only when the user clicks "Send it yourself": `POST /api/devcon/gas { tokenId }` (signed-in
  session = owner of tokenId). The server checks the owner's Sepolia balance; if below what one
  `recordFor` needs (estimate × 2), it sends a small amount (~0.005 ETH) from the relayer.
- At most once per badge (tokenId), ever. Recorded in KV (`devcon:gas:<tokenId>`, written before
  sending, under the relayer queue) — Claude's call: this is a spend guard, not a code registry.
- Mint has no self-send path (only MINTER_ROLE can mint), so the claim step offers Retry only.

### Delivery order (user's decision)

1. Tonight: deploy + setup, and the QR sheet (has to be printed).
2. First thing: `/devcon/:code` intro, sign-in, claim/mint, ballot, relay with receipt check and
   Retry.
3. Then the `/devcon` projector (may land a few hours into day one).
4. Last: "Send it yourself" and the gas drip.

## Left to the builder

- Exact copy, button wording, meme variants (offer options to the user).
- Projector colors and headline layout (show a mockup).
- Sepolia RPC provider choice; Etherscan link format.
- QR/PDF library choice for the code script.
