# Vote What-ifs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every initiative on the vote results says how close it is to the tier above, S-Tier initiatives how far ahead they are, and a not-funded initiative's "needed $X" what would happen if it went in — during the vote and frozen at each settlement after it.

**Architecture:** The replay records the tally inputs as each tier settles. `shared/vote/next-tier.ts` gains a per-initiative gap search with an explicit target tier (knock-on limited to that tier) and an S-Tier lead search; a `finalWhatIfs` runs them against the settlement inputs. The API serves them (open: `live.lead`; closed: `final`) from the same background, digest-keyed, KV-cached job as `live.next`. The UI draws them in the right-hand slot.

**Tech Stack:** Deno + Hono, React, vitest (`deno task test`), `deno task test:api`.

**Spec:** `docs/superpowers/specs/2026-11-11-vote-screens-design.md`, section 3 (decisions 5–7).

## Global Constraints

- `$1K` steps: `STEP = 1_000_000_000n` micro-USD. Gaps round **up**; leads round **down**.
- Copy: "S-Tier, A-Tier and B-Tier" via `tierName`; "initiatives". Lead reads `"{usdShort(lead)} ahead"`; gap reads `"{usdShortUp(gap)} to {tierName}"` (existing); not funded reads `"needed {usdShort(need)}"` (existing).
- After the vote, knock-on lists only cover the target tier; the hover says "drops out of X-Tier" / "comes into X-Tier".
- `chainTally` and the replay's funding results must not change; every existing quiet-ending, stage, next-tier and API test passes unchanged.
- The what-ifs never block the isolate: computed in the existing background job (yielding), once per digest, cached in KV under a guarded key.
- Commit messages `Vote: …`; only your files.

## Review Focus

1. **A tier that settled from a KV snapshot** (frozen settlement): its settle inputs must still be recorded (same ballots/needs as the snapshot's). → Task 1 test `settle inputs are kept when the settlement comes from a snapshot`.
2. **S-Tier lead below one step:** a lead under $1K is 0n and the UI shows nothing (never "$0 ahead"). → Task 2 test `a lead under $1K is no lead`; Task 4 test `a lead under $1K shows nothing`.
3. **An initiative not funded because it doesn't fit the pool** at B's settlement: "needed $X" has no hover (gap null), just the text. → Task 4 test `needed with no way in has no hover`.
4. **Closed round whose settlement had no ballots:** no figures, no crash. → Task 2 test `no ballots at a settlement: no figures`.
5. **Open round with S-Tier already settled:** no leads (S-Tier is final, shown on the final figures only after close). → Task 3 test `no leads once S-Tier has settled`.

---

### Task 1: The replay keeps each settlement's inputs

**Files:** Modify `shared/vote/quiet-ending.ts`; Test `shared/vote/quiet-ending.test.ts`

**Interfaces — Produces:** `RoundState.settleInputs: (ChainInputs | null)[]` (index = tier 0..2; null until that tier settles): the `ChainInputs` the settlement of that tier tallied from (its needs: `settleNeeds[tier].needs ?? needs`), recorded also when the settlement came from a snapshot.

- [ ] **Step 1: Failing tests** — `each settlement keeps its inputs`: on a fixture where S and A settle, `chainTally(st.settleInputs[t]!, t, t + 1)[0].order` equals `st.tiers[t].funded` (as indices) for t = 0, 1, and `st.settleInputs[2]` is null while B waits; `settle inputs are kept when the settlement comes from a snapshot`.
- [ ] **Step 2:** Run `deno task test shared/vote/quiet-ending.test.ts` — FAIL.
- [ ] **Step 3:** Implement in `settle`: build the inputs with the same `inputs(costs)` helper before the snapshot early-return; store at index t.
- [ ] **Step 4:** Run `deno task test shared/vote/` — all PASS, existing unchanged.
- [ ] **Step 5:** Commit `Vote: the replay keeps the inputs each tier settled from`

### Task 2: Gap to a chosen tier, S-Tier lead, and the final what-ifs

**Files:** Modify `shared/vote/next-tier.ts`; Test `shared/vote/next-tier.test.ts`

**Interfaces — Consumes:** `ChainInputs`, `chainTally`, Task 1's `settleInputs`. **Produces:**
```ts
/** Gap for one initiative to reach `target` (tier index), judged with `inp` from tier `first`.
 * `onlyTarget`: the knock-on lists only cover changes in the target tier. */
export function gapTo(inp: ChainInputs, first: number, c: number, target: number,
  opts?: { onlyTarget?: boolean; tally?: Tally }): NextTier;
/** Largest STEP multiple L (rounded down) with c still funded in tier `first` when its cost
 * and the pool are both raised by L; null when it isn't funded there at all; 0n under $1K. */
export function leadIn(inp: ChainInputs, first: number, c: number, tally?: Tally): bigint | null;
/** Open round: leads for initiatives funded in S-Tier by the live tally (only while firstOpen = 0). */
export function liveLeads(inp: ChainInputs, firstOpen: number, tally?: Tally): Map<number, bigint>;
export type FinalWhatIfs = { next: Map<number, NextTier>; lead: Map<number, bigint> };
/** Closed round: tier k's initiatives (k ≥ 1) → gapTo tier k−1 judged at settleInputs[k−1];
 * S-Tier's → leadIn at settleInputs[0]; not funded → gapTo B-Tier at settleInputs[2].
 * Knock-on: onlyTarget. Missing settle inputs → no figure. */
export function finalWhatIfs(settleInputs: (ChainInputs | null)[], finalTier: Map<number, number>,
  m: number, tally?: Tally): FinalWhatIfs;
```
plus async variants `liveLeadsAsync`, `finalWhatIfsAsync` yielding between tallies (reuse the generator pattern). `nextTiers` is rewritten on top of `gapTo` (behaviour unchanged).

- [ ] **Step 1: Failing tests:** `gapTo reaches a chosen tier and lists only that tier's changes`; `a lead is the backing it could lose and stay in S-Tier` (at L it is funded in S, at L + STEP it is not); `a lead under $1K is no lead` (0n); `leadIn is null when not funded in S-Tier`; `finalWhatIfs judges each figure at the settlement above` (fixture: one initiative per tier + one unfunded; check targets and that each figure equals `gapTo`/`leadIn` on the right settle inputs); `no ballots at a settlement: no figures`; existing `nextTiers` tests unchanged.
- [ ] **Step 2:** Run `deno task test shared/vote/next-tier.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `deno task test shared/vote/` — PASS.
- [ ] **Step 5:** Commit `Vote: gap to a chosen tier, the S-Tier lead, and the final what-ifs`

### Task 3: The API serves leads and the final what-ifs

**Files:** Modify `api/routes/vote.ts`, `app/hooks/use-vote.ts`; Test `api/tests/vote-round.test.ts`

**Interfaces — Produces on `RoundView`:**
- `live.lead?: Record<slug, string>` (micro-USD) — open round, while S-Tier is open.
- `final?: { next: Record<slug, NextTierEntry>; lead: Record<slug, string> }` — closed round. `NextTierEntry` gains nothing; for the final, `comesIn`/`dropsOut` only name the target tier.

Computed in the existing background job next to `live.next` (same digest, single-flight, yielding, KV-cached with the size guard). For the closed round the digest covers `settleInputs` (and never changes once closed).

- [ ] **Step 1: Failing tests:** `an open round serves S-Tier leads`; `no leads once S-Tier has settled`; `a closed round serves the final what-ifs` (A initiative has `final.next[slug].tier === "S"`, S initiative has `final.lead[slug]`, unfunded has `final.next[slug].tier === "B"`).
- [ ] **Step 2:** Run `deno task test:api api/tests/vote-round.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `deno task test:api`, `deno task check:api` — PASS.
- [ ] **Step 5:** Commit `Vote: the round view serves leads and the final what-ifs`

### Task 4: The UI draws them

**Files:** Modify `app/components/vote/NextTier.tsx`, `app/components/board/InitiativeCard.tsx`, `app/components/board/BoardList.tsx`, `app/components/board/BoardPage.tsx`, `app/components/vote/VoteResults.tsx`; Tests `app/components/vote/NextTier.test.tsx`, `app/components/vote/VoteResults.test.tsx`

**Interfaces:**
- `LeadFigure({ lead }: { lead: string /* micro-USD */ })` in `NextTier.tsx`: `"{usdShort(dollars(lead))} ahead"`, with a `title`/tooltip "Could lose this much backing and still be funded in S-Tier."; nothing when under $1K.
- `NextTierFigure` gains `label?: string` (trigger text override, used for "needed $X") and `final?: boolean` (heading: `"With {gap} more backing it would have made {tier}:"`; list labels "Comes into {tier}" / "Drops out of {tier}").
- BoardPage `next`/`lead` maps (by initiative id) feed cards and rows in both states; VoteResults builds them from `live.next`/`live.lead` (open) or `final.next`/`final.lead` (closed).
- Closed rows: S-Tier → LeadFigure; A-Tier and B-Tier → NextTierFigure (final); not funded → NextTierFigure with `label="needed $X"` when it has an entry with a gap, else the plain "needed $X" text. The tier chip on rows inside tier sections is replaced by the figure.
- Open: S-Tier cards show the chip and LeadFigure side by side; others unchanged.

- [ ] **Step 1: Failing tests:** `S-Tier shows how far ahead it is`; `a lead under $1K shows nothing`; `after the vote, the hover names the target tier` ("Drops out of S-Tier: …"); `needed opens what would have happened`; `needed with no way in has no hover`; `an open round shows S-Tier leads`.
- [ ] **Step 2:** Run `deno task test app/components/vote` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `deno task test`, `deno task typecheck`, `deno lint` — PASS (except the two `/vote` gate tests while the local demo bypass is in place; they are not this task's).
- [ ] **Step 5:** Commit `Vote: leads, gaps and what-ifs on every initiative`
