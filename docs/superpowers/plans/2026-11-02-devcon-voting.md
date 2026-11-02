# DevCon One-Day Badge Holders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paper QR codes at Devcon 8 turn their scanners into one-day badge holders who vote on a Sepolia `SignedBallots` round and watch the live result on a projector.

**Architecture:** One pure shared module (`shared/devcon/`) holds the code format, ballot encoding, EIP-712 typed data, receipt check and tally; app and API both import it. The API gets a `devcon` route group backed by an injectable Sepolia adapter (viem) that mints and relays under a KV lease. Two new SPA routes: `/devcon/:code` (intro → sign-in → claim → ballot) and `/devcon` (projector reusing `BoardList`). Contract is deployed unchanged by a Deno+viem script that writes a committed manifest.

**Tech Stack:** React Router 8 SPA, wagmi 3 / Privy, viem 2, Deno + Hono + Deno KV, Foundry (Solidity 0.8.28), vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-02-devcon-voting-design.md`

## Global Constraints

- No changes to `vote/contracts/*.sol`.
- Close C = `1793989800` (2026-11-06 18:30:00 UTC; checked with `date -u -d`). Ballots/mints count only with block timestamp `< C`.
- Pool: `poolUsd = 913_244_000_000` (six decimals, 400 ETH × $2,283.11).
- Schedule: `maxWindows = 1`, `initialWindow = 1`, `firstTallyAt = [C-1, C, C+1]`.
- Code message (EIP-191): `` `TheDAO Devcon 8 badge #${n}` ``; code string `<n>.<base64url(65-byte sig)>`; `n` positive integer, no upper bound.
- EIP-712 domain: name `BlossomBallots`, version `2`, chainId `11155111`, verifyingContract = manifest contract. Type `Vote(uint256 tokenId,address voter,uint64 nonce,bytes ballot)`.
- Ballot bytes: one per initiative in manifest order; unplaced = `255`; tiers S/A/B use competition ranks; `0` never appears.
- Admin handoff to `0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF` (sem-the-bee.eth); relayer keeps only `MINTER_ROLE`.
- The QR issuer private key never enters the repo, the server, or env files the server reads. Server knows only `DEVCON_ISSUER` (address).
- Gas drip: ≤ 1 per tokenId ever, `0.005` ETH, only on "Send it yourself" click and only if balance is below 2× the `recordFor` estimate.
- `deno task fmt`, `deno task lint`, `deno task check:api`, `deno task typecheck` clean before each commit.

## Review Focus

1. A mangled or truncated QR URL (bad base64, missing dot, `n=0`, non-numeric) → "This code doesn't look right" screen, never a crash or a 500. Tests in Task 1 (`parseCode`) and Task 4 (`GET /code`).
2. Signed in with a different account than the badge's owner → the page says the badge belongs to another account and offers sign-out; it never offers to vote. Test in Task 6.
3. Relay tx lands late after the user pressed Retry → Retry first re-reads `nonceOf`/`ballotHashOf`; if the earlier tx already recorded this exact ballot, show "Counted" instead of resending. Test in Task 6 (`submitBallot` state machine).
4. Double-tap Submit / two tabs → the API refuses a second relay for the same `(tokenId, nonce)` while one is pending (409 `pending`, returns the existing hash). Test in Task 4.
5. Sepolia RPC hiccup on the projector → keep showing the last results with "updated N s ago"; no blank screen. Test in Task 7.

---

### Task 1: Shared DevCon core

**Files:**
- Create: `shared/devcon/manifest.ts`, `shared/devcon/manifest.json` (placeholder until Task 3 deploys), `shared/devcon/code.ts`, `shared/devcon/ballot.ts`, `shared/devcon/typed-data.ts`, `shared/devcon/receipt.ts`, `shared/devcon/abi.ts` (`cd vote && forge build`, then the `abi` array of `vote/out/SignedBallots.sol/SignedBallots.json` exported `as const`)
- Test: `shared/devcon/code.test.ts`, `shared/devcon/ballot.test.ts`, `shared/devcon/receipt.test.ts` (vitest already includes `shared/**/*.test.ts`)

**Interfaces:**
- Produces:
  - `type DevconManifest = { chainId: 11155111; contract: \`0x${string}\`; deployBlock: number; opensAt: number; closesAt: number; poolUsd: string; issuer: \`0x${string}\`; slugs: string[] }`; `export const DEVCON: DevconManifest` (from the JSON).
  - `codeMessage(n: number): string`
  - `parseCode(code: string): { n: number; signature: \`0x${string}\` } | null`
  - `formatCode(n: number, signature: \`0x${string}\`): string`
  - `verifyCode(code: string, issuer: string): Promise<number | null>` (viem `recoverMessageAddress`, case-insensitive compare)
  - `type Tier = "S" | "A" | "B"`; `encodeBallot(slugs: string[], tiers: Partial<Record<string, Tier>>): Uint8Array`; `decodeBallot(bytes: Uint8Array, slugs: string[]): Partial<Record<string, Tier>>`; `isValidOnchainBallot(bytes: Uint8Array, m: number): boolean` (exact port of `SignedBallots._validateBallot`)
  - `voteTypedData(m: DevconManifest, tokenId: bigint, voter: \`0x${string}\`, nonce: bigint, ballot: \`0x${string}\`)` → viem `TypedDataDefinition`
  - `checkBallotTx(input: { m: DevconManifest; tx: { to: string | null; input: \`0x${string}\` }; status: "success" | "reverted"; blockTimestamp: number; expect: { tokenId: bigint; nonce: bigint; ballot: \`0x${string}\` } }): "counted" | "reverted" | "late" | "mismatch"` — accepts calldata of `recordFor` or `vote` (decode with viem `decodeFunctionData` and `SIGNED_BALLOTS_ABI` from `shared/devcon/abi.ts`).

- [ ] **Step 1: Write failing tests**

```ts
// code.test.ts
const key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
test("round-trips a signed code", async () => {
  const acct = privateKeyToAccount(key);
  const sig = await acct.signMessage({ message: codeMessage(17) });
  expect(await verifyCode(formatCode(17, sig), acct.address)).toBe(17);
});
test("rejects another issuer, another number, garbage", async () => {
  const sig = await privateKeyToAccount(key).signMessage({ message: codeMessage(17) });
  expect(await verifyCode(formatCode(18, sig), privateKeyToAccount(key).address)).toBeNull();
  for (const bad of ["", "17", "17.", "0.abc", "-1.abc", "x.abc", "17.%%%", `17.${"A".repeat(10)}`]) {
    expect(parseCode(bad)).toBeNull();
  }
});
test("codes past 200 are valid", async () => { /* n = 201 and n = 100000 verify */ });

// ballot.test.ts
const slugs = ["a", "b", "c", "d"];
test("encodes tiers as competition ranks with 255 for unplaced", () => {
  expect([...encodeBallot(slugs, { a: "A", b: "S", c: "S" })]).toEqual([3, 1, 1, 255]);
  expect([...encodeBallot(slugs, { d: "B" })]).toEqual([255, 255, 255, 1]);
});
test("on-chain validity matches the contract", () => {
  expect(isValidOnchainBallot(Uint8Array.from([1, 1, 3, 255]), 4)).toBe(true);
  expect(isValidOnchainBallot(Uint8Array.from([0, 255, 255, 255]), 4)).toBe(false); // 0 reverts on-chain
  expect(isValidOnchainBallot(Uint8Array.from([2, 255, 255, 255]), 4)).toBe(false); // gap
  expect(isValidOnchainBallot(Uint8Array.from([1, 255, 255]), 4)).toBe(false); // length
});
test("decode inverts encode", () => { /* random tier maps round-trip */ });

// receipt.test.ts — build calldata with encodeFunctionData for recordFor and vote
test("counted: right contract, function, token, nonce, bytes, success, before close");
test("late: same tx with blockTimestamp === closesAt");
test("mismatch: other contract | other token | other nonce | other ballot");
test("reverted: status reverted");
```

- [ ] **Step 2: Run `deno task test shared/devcon` — FAIL (modules missing)**
- [ ] **Step 3: Implement the six modules.** `encodeBallot`: rank of tier S = 1, A = 1 + |S|, B = 1 + |S| + |A|. base64url via `@std/encoding`-free code (shared runs in both runtimes: use `btoa`/`atob` with `-_` replacement). `parseCode` requires `^[1-9]\d{0,9}\.[A-Za-z0-9_-]{86,88}$` and a decoded length of exactly 65.
- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit** `git commit -m "DevCon: shared code, ballot, typed data and receipt check"`

### Task 2: QR code sheet script (tonight, user runs it)

**Files:**
- Create: `scripts/devcon-codes.ts`, `scripts/devcon-codes.test.ts`
- Modify: `deno.json` (task `devcon-codes`), `.gitignore` (`devcon-codes/`)

**Interfaces:**
- Consumes: `codeMessage`, `formatCode` (Task 1).
- Produces: `deno task devcon-codes --from 1 --to 200 --base-url https://<site>` reading `DEVCON_ISSUER_KEY` from the environment (not `--env-file`), writing `devcon-codes/codes.csv` (`n,url`) and `devcon-codes/codes.pdf` (A4, 4×5 grid, QR ≥ 35 mm, the number under each, cut lines). Prints the issuer address at the end for `DEVCON_ISSUER`.
- Exported helper `signCodes(key, from, to, baseUrl): Promise<{ n: number; url: string }[]>` for the test.

- [ ] **Step 1: Failing test** — `signCodes(testKey, 1, 3, "https://x")` returns 3 URLs `https://x/devcon/<code>` and each verifies with `verifyCode` against the key's address.
- [ ] **Step 2: Run `deno test scripts/devcon-codes.test.ts` — FAIL**
- [ ] **Step 3: Implement.** QR: `npm:qrcode` (`toBuffer` PNG, error correction `M`); PDF: `npm:pdf-lib`. Refuse to run if `DEVCON_ISSUER_KEY` is missing; never print the key.
- [ ] **Step 4: Run test — PASS; run it once with a throwaway key and open the PDF to check scan size by phone.**
- [ ] **Step 5: Commit** `git commit -m "DevCon: QR code sheet script"`
- [ ] **Step 6 (user):** `cast wallet new` → keep the key offline; `DEVCON_ISSUER_KEY=0x… deno task devcon-codes --from 1 --to 200 --base-url <prod url>`; print; send me the address.

### Task 3: Sepolia deployment (tonight)

**Files:**
- Create: `vote/test/DevconSchedule.t.sol`, `scripts/devcon-deploy.ts` (bytecode from `vote/out/SignedBallots.sol/SignedBallots.json`)
- Modify: `shared/devcon/manifest.json` (written by the script, committed)

**Interfaces:**
- Consumes: `/api/board` from production (initiative order = board order at deploy time).
- Produces: deployed contract + `shared/devcon/manifest.json` with every `DevconManifest` field; `slugs[i]` ↔ on-chain initiative `i`.

- [ ] **Step 1: Failing Foundry test** `DevconScheduleTest` deploying with the Global Constraints schedule (warp to before C):
  - `mint` at `C-1` succeeds; `mint` at `C` reverts `RegistrationClosed`.
  - first `vote` for a fresh token at `C` reverts `NotRegistered`.
  - a revision for a registered token at `C+1` **succeeds** (documents why the app checks `< C`); at `C+2` reverts `VotingClosed`.
  - `setPoolUsd(913_244e6)` before `C-1` succeeds.
  - after the role handoff, the relayer can `mint` but `addInitiative`/`setPoolUsd` revert, and `0xf632…05cF` holds `DEFAULT_ADMIN_ROLE` and `ADMIN_ROLE`.
- [ ] **Step 2: `cd vote && forge test --match-contract DevconSchedule` — FAIL then write the test body until it compiles; it should PASS against the unchanged contract (a failure means the schedule constants are wrong).**
- [ ] **Step 3: Implement `scripts/devcon-deploy.ts`** (viem, Sepolia, `DEVCON_RELAYER_KEY`, `SEPOLIA_RPC_URL`): deploy with `opensAt = now + 15 min`; `addInitiative(account, goalUsd × 1e6)` per board card where `account = safeAddress` if non-empty and unseen, else `getAddress(slice(keccak256(toBytes("devcon8:" + slug)), 12))`; `setPoolUsd`; `grantRole` ×3 to admin; `renounceRole` for `DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `PLEDGE_ROLE`, `BLOB_SUBMITTER_ROLE`; wait for each receipt; abort loudly if any step fails before `opensAt`. Writes the manifest. `--dry-run` runs against an `anvil --fork-url` Sepolia.
- [ ] **Step 4: Dry run on anvil, then the real run. Verify on Sepolia Etherscan: `initiativeCount() == slugs.length`, `poolUsd()`, roles.**
- [ ] **Step 5: Commit** `git commit -m "DevCon: Sepolia deployment and manifest"`

### Task 4: API — code, claim, ballot relay

**Files:**
- Create: `api/services/devcon-chain.ts`, `api/routes/devcon.ts`, `api/tests/devcon.test.ts`
- Modify: `api/config.ts` (`devconRelayerKey`, `sepoliaRpcUrl` default `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}` else `https://ethereum-sepolia-rpc.publicnode.com`), `api/middleware/context.ts` (`devcon: DevconChain` in `Deps`), `api/bootstrap.ts` (wire real adapter), `api/app.ts` (`app.route("/api/devcon", devconRoutes(deps))`), `api/tests/app-helpers.ts` (fake adapter), `.env.example`

**Interfaces:**
- Consumes: Task 1 (`DEVCON`, `verifyCode`, `isValidOnchainBallot`, `voteTypedData`).
- Produces:
  ```ts
  interface DevconChain {
    ownerOf(n: bigint): Promise<`0x${string}` | null>;
    balanceOf(a: `0x${string}`): Promise<bigint>;
    hasCode(a: `0x${string}`): Promise<boolean>;
    nonceOf(n: bigint): Promise<bigint>;
    ballotHashOf(n: bigint): Promise<`0x${string}`>;
    balance(a: `0x${string}`): Promise<bigint>;
    send(call: { fn: "mint" | "recordFor"; args: readonly unknown[] } | { fn: "drip"; to: `0x${string}`; value: bigint }): Promise<`0x${string}`>;
    ballots(): Promise<{ tokenId: string; ballot: `0x${string}`; timestamp: number }[]>;
  }
  ```
  `send` runs under a KV lease `["devcon","relayer"]` (30 s expiry, atomic check) and uses the `pending` nonce.
- Routes (JSON errors via `HttpError` with `{ error, code }`):
  - `GET /api/devcon/code/:code` → `{ n, claimed: boolean, owner: string | null }` or 400 `{ code: "bad_code" }`
  - `POST /api/devcon/claim { code }` (session required) → `{ hash }`; 400 `bad_code`, 409 `claimed`, 409 `one_per_person`, 422 `smart_wallet`, 410 `closed`
  - `POST /api/devcon/ballot { tokenId, nonce, ballot, signature }` → `{ hash }`; 400 `bad_ballot` (incl. rank 0), 401 `bad_signature`, 409 `stale_nonce` (`nonce !== nonceOf + 1`), 409 `pending` (+ `hash`) when KV `["devcon","pending",tokenId,nonce]` exists (TTL 10 min), 410 `closed`
  - Rate limit claim and ballot per IP with the existing rate limiter (key names `devcon-claim`, `devcon-ballot`, 30/min).

- [ ] **Step 1: Failing tests** using the harness + fake adapter: one test per status above, plus: claim mints to the **session** address with `tokenId = n`; two simultaneous claims by the same address → exactly one `send` (the lease covers the `balanceOf` read); ballot relays `recordFor(tokenId, nonce, ballot, signature)` verbatim; a ballot signed by a non-owner → 401; time `>= closesAt` → 410 on both.
- [ ] **Step 2: `deno test -A api/tests/devcon.test.ts` — FAIL**
- [ ] **Step 3: Implement adapter (viem `createPublicClient`/`createWalletClient`, `sepolia`) and routes.** Signature check: viem `verifyTypedData` against `ownerOf(tokenId)`.
- [ ] **Step 4: Tests PASS; `deno task test:api` and `deno task check:api` clean.**
- [ ] **Step 5: Commit** `git commit -m "DevCon API: code check, claim and ballot relay"`

### Task 5: Sepolia in the wallet setup

**Files:**
- Modify: `app/lib/wagmi.ts` (chains `[mainnet, sepolia]`, transport `sepolia: http(VITE_SEPOLIA_RPC_URL || undefined)`), `app/context/privy.tsx` (`supportedChains: [mainnet, sepolia]`, `defaultChain` stays mainnet)
- Create: `app/hooks/use-sepolia.ts` — `useEnsureSepolia(): () => Promise<void>` (wagmi `switchChain` to 11155111 when the connected chain differs; throws a typed `WrongChainError` if the wallet refuses)
- Test: `app/hooks/use-sepolia.test.tsx`

- [ ] **Step 1: Failing test** with the mock connector: on mainnet, `ensure()` calls `switchChain({ chainId: 11155111 })`; on Sepolia it does nothing.
- [ ] **Step 2: Run `deno task test app/hooks/use-sepolia` — FAIL**
- [ ] **Step 3: Implement.** Check donate flows still pin mainnet (`grep -rn "chainId" app/components/donate`); add `chainId: mainnet.id` where a call relies on the default.
- [ ] **Step 4: `deno task test` (whole suite) — PASS**
- [ ] **Step 5: Commit** `git commit -m "Wallets: add Sepolia for the DevCon vote"`

### Task 6: `/devcon/:code` — intro, claim, ballot, relay with check and Retry

**Files:**
- Modify: `app/routes.ts` (`route("devcon/:code", "routes/devcon.code.tsx")` before `route("devcon", ...)`)
- Create: `app/routes/devcon.code.tsx`, `app/components/devcon/Intro.tsx`, `app/components/devcon/TierBallot.tsx` (port of `../blossomlabs.eth/src/components/budgeting/voting/tier-list.tsx` restyled with this site's tokens/`Button`; tiers S "Must fund", A "Should fund", B "Nice to have"), `app/components/devcon/BallotStatus.tsx`, `app/hooks/use-devcon.ts`
- Test: `app/routes/devcon.code.test.tsx`, `app/hooks/use-devcon.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 4 routes, Task 5 `useEnsureSepolia`, `useSession().requireSession`, `useWalletPicker().openWalletPicker`.
- Produces: `useDevconCode(code)` (query on `GET /code`), `useClaim()`, and `submitBallot` — a reducer with states `idle → signing → relaying → waiting(hash) → counted | failed(reason) | late`, actions `submit`, `retry`, `txMined`, `txFailed`. `retry` first reads `nonceOf`/`ballotHashOf` (public client) and goes to `counted` if the chain already holds `keccak256(ballot)` at that nonce.

Screens (copy is a first draft; show the user and adjust):
- Intro: **"You're a TheDAO badge holder. For one day."** / "Rank the security initiatives TheDAO could fund from a $913,244 pool. Every ballot moves the result live on the big screen. Voting closes Friday 6 November, midnight in Mumbai." Button: **"Accept the challenge"**. Bad code → "This code doesn't look right. Try scanning it again." Claimed by someone else → "This badge is already taken."
- One per person (409 `one_per_person`): **"Nice try, bad kid 😏 One badge per person."** with a link to their existing ballot. Smart wallet (422): "Use email or a regular wallet for this one."
- Owner mismatch (signed-in address ≠ `owner`): "This badge belongs to another account." + sign out.
- Status: waiting → "Recording your ballot on Sepolia…" + Etherscan link; counted → "Counted ✓ You can change it until voting closes." + "See the live results" → `/devcon`; failed → "Didn't go through." + **Retry**; late → "Voting had closed when this landed."
- After `closesAt`: ballot read-only, "Voting closed" + results link.

- [ ] **Step 1: Failing tests:** reducer transitions (incl. Review Focus 3: retry after the first tx landed → `counted`, no second POST); route test with mocked API: bad code screen, claimed screen, intro → click button → `openWalletPicker` called only then (not on load); owner mismatch screen (Review Focus 2); 409 `one_per_person` shows the meme line; encoded ballot posted equals `encodeBallot` of the UI state (never contains 0).
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement.** Sign with wagmi `signTypedData(voteTypedData(...))` after `ensureSepolia()`; wait with a Sepolia public client `waitForTransactionReceipt` + `getTransaction` + `getBlock`, then `checkBallotTx`. Persist the last `{ hash, nonce, ballot }` in `sessionStorage` so a reload resumes the wait.
- [ ] **Step 4: Tests PASS; manual run on the dev server with the mock wallet against the Sepolia deployment (one real claim + ballot).**
- [ ] **Step 5: Commit** `git commit -m "DevCon: claim page and ballot"`
- [ ] **Step 6: Deploy to production; scan a printed code with a phone (email sign-in) end-to-end.**

### Task 7: Results tally and `/devcon` projector

**Files:**
- Create: `shared/devcon/tally.ts`, `shared/devcon/tally.test.ts`, `app/routes/devcon.tsx`, `app/routes/devcon.test.tsx`
- Modify: `api/routes/devcon.ts` (`GET /api/devcon/ballots`, KV-cached 5 s, latest ballot per token with `timestamp < closesAt`), `app/routes.ts`, `app/components/board/BoardList.tsx` (optional prop `votePct?: ReadonlyMap<string, number>` keyed by initiative id; `FundingBar` draws it as a second segment after the green fill in a new token `--color-vote` (gold, `#e9b949`), total capped at 100%)

**Interfaces:**
- Consumes: Task 1 `DEVCON`, `decodeBallot`; `vote/shared/pbear.ts` `pbearTranscript`; `useBoard()` cards.
- Produces: `devconTally(cards: { slug: string; goalUsd: number; total: number }[], ballots: Uint8Array[], slugs: string[], poolUsd: bigint): { bySlug: Map<string, number /* USD */>; fundedUsd: number; ballots: number }`. Cost per slug = `max(0, goal − total)` in micro-USD; cost 0 → skipped (not in the tally); weight = `poolUsd / ballots.length` (floor); ballots passed to `pbearTranscript` as ranks with 255 → withheld.

- [ ] **Step 1: Failing tests:** 0 ballots → nothing funded, `fundedUsd = 0`; one ballot with S = cheapest remaining → funded at its remaining cost; donation that fully funds an initiative removes it; the tally matches `pbearTranscript` on a 3-ballot fixture; projector route with a failing ballots fetch keeps the previous numbers and shows "updated N s ago" (Review Focus 5).
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement.** Projector: headline **"Devcon is voting. Live."**, sub-line "If voting closed right now, badge holders would fund $X of the $913,244 pool — N ballots so far. Closes in HH:MM." then `BoardList` with the homepage's cards and order and `votePct = share / goal × 100`, legend (green "already raised", gold "from the Devcon vote"). Polls ballots every 5 s and the board on its usual interval. After `closesAt`: "Voting closed. Final result." Large type: wrap in a `text-[1.15em]` container; check on a 1920×1080 window.
- [ ] **Step 4: Tests PASS; the homepage list looks unchanged when `votePct` is absent (existing `BoardList` tests).**
- [ ] **Step 5: Commit** `git commit -m "DevCon: live results projector"`; deploy.

### Task 8: Send it yourself + gas drip

**Files:**
- Modify: `api/routes/devcon.ts` (`POST /api/devcon/gas { tokenId }`), `api/tests/devcon.test.ts`, `app/components/devcon/BallotStatus.tsx`, `app/hooks/use-devcon.ts`, `app/routes/devcon.code.test.tsx`

**Interfaces:**
- Consumes: `DevconChain.balance/send({ fn: "drip" })`, `estimateGas` of `recordFor` (adapter method `estimateRecordFor(): Promise<bigint>` — add it to `DevconChain`).
- Produces: `POST /api/devcon/gas` → `{ hash: string | null }` (`null` = enough balance already); 403 unless session address = `ownerOf(tokenId)`; 409 `already_dripped` if KV `["devcon","gas",tokenId]` exists (written atomically **before** sending, under the relayer lease); 410 `closed`.

- [ ] **Step 1: Failing tests:** low balance → one drip of `5e15` wei and the KV mark; second call → 409 and no send; enough balance → `{ hash: null }`, no mark; non-owner → 403. UI: "Send it yourself" visible next to Submit and next to Retry; clicking it calls `/gas`, waits for that receipt if any, then `writeContract(recordFor, same signature)` from the user's wallet and feeds the hash into the same `waiting` state.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Tests PASS; full `deno task test`, `deno task test:api`, lint, fmt, typecheck.**
- [ ] **Step 5: Commit** `git commit -m "DevCon: send it yourself, with a one-time gas drip"`; deploy.
