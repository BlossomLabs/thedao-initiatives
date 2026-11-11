# Ballot rules — design

**Date:** 11 November 2026 · **Branch:** `vote` · **Status:** draft for review

Builds on [the vote design](2026-11-11-vote-design.md) (phases 1 and 2: the private voting
badge vote, the quiet ending replayed tier by tier).

## Why

The vote must fund a spread of work that badge holders actually rated well, not a
handful of related projects, and not projects nobody chose. Today a ballot can put one
family of projects alone in Tier-S, can be so short that it barely spreads money, and
starts empty although every badge holder has already rated the initiatives with stars.

Three things follow:

1. **Start from what the voter already said.** Their own badge's star ratings prefill the
   ballot.
2. **Rules that make a ballot valid.** A minimum ballot size, and independence rules for
   Tier-S. A ballot that breaks them is **invalid**: the page will not send it, the relayer
   refuses it, the contract reverts it, and the tally never counts it.
3. **Help building it.** Paste a ballot in the pabutools (Pabulib) format, and a
   `/vote/llms.txt` so a voter can have an LLM draft it.

**Anti-goals.** The explanation voters read must match exactly what the algorithm does:
no hidden option, no checkbox that changes what happens to leftover money, no C tier.
Tags must not appear in the UI as decoration or labels.

## Decisions (the user's)

- **Prefill** from the voting badge's own star ratings: 5★ → Tier-S, 4★ → Tier-A,
  3★ → Tier-B. Projects rated 1–2★, or not rated by this badge, start unplaced.
- The voter can **add or remove any project**, whatever its rating.
- **Unplaced projects get nothing.** The share they would have taken returns to the DAO.
  This is how the contract already works (unplaced = withheld, byte 255).
- **No C tier, no hidden checkbox.** Only S, A, B and unplaced.
- **Minimum ballot size:** the total requested by the placed projects must be at least
  1.5× the budget being distributed (the pool).
- **Tier-S independence:**
  - At least 3 independent projects. Related projects count as one.
  - RFPs are wildcards: each RFP counts as independent.
  - No single related group can hold more than half of the tier's funds.
  - These rules never apply to Tier-B. Whether they apply to Tier-A is undecided, so it is
    a per-round setting (default: Tier-S only).
- **Relatedness is tags.** Projects get a new `tags` field (e.g. `Seal`). Projects sharing
  a tag are related. The tag is its own display name. A project may have several tags.
  **No chains:** relatedness is only a direct shared tag (if a–b share one tag and b–c
  another, a and c are not related).
- **RFPs cannot have tags.**
- **Tags stay out of the UI**, except in a ballot error ("X and Y are related to Seal…")
  and in the admin's edit form. They **are** listed in `/vote/llms.txt`.
- **Rules block sending.** A ballot breaking any rule is invalid.
- **The tally refuses invalid ballots too**, not just the page.
- **The contract registers the tags** (as pre-computed groups, see below) and checks the
  rules. Independence is checked against a **proof** sent alongside the ballot.
- **New projects can be added after the vote opens**, but not while a tier's quiet ending
  is running.
- **Paste format:** pabutools/Pabulib `.pb`, with the Blossom extension for ties.
- In the voter instructions, **encourage adding many projects to Tier-B.**
- In running text a tier is always written **Tier-S / Tier-A / Tier-B**; the bare letter
  appears only in the tier table (already done on `vote`, b359cc1).

## The rules, exactly

Definitions, for one ballot, at the block that records it:

- **Placed projects:** those in Tier-S, Tier-A or Tier-B.
- **Requested amount** of a project: its `askUsd` registered in the contract (micro-USD),
  i.e. the initiative's requested total. Not the remaining need, which moves with
  donations: a ballot's validity must not change after it is recorded. *(My call; the
  tally itself still uses remaining needs.)*
- **Pool:** `poolUsd` in the contract at that block.
- **Tiers as the contract sees them:** the ballot's groups of equal rank, in order. The
  first group is Tier-S, the second Tier-A, the third Tier-B. A valid ballot has at most
  three groups. Because Tier-S must hold at least 3 projects, the first group is always
  the voter's Tier-S. When Tier-A is enforced, the second group must likewise hold at
  least 3 projects, so it is always the voter's Tier-A: an empty Tier-A is then invalid
  ("Tier-A needs at least 3 independent projects"), and the page blocks it like any rule.
  *(My call: the rule read literally. The proof is then always 6 indexes.)*
- **Related:** two projects share at least one tag (group). RFPs have no groups.

A ballot is **valid** when all of these hold:

1. **Shape** (existing): every byte is 255 (unplaced) or a competition rank in `1..m`
   with no gaps; plus **at most three rank groups** (new).
2. **Minimum size:** `2 × Σ requested(placed) ≥ 3 × pool`.
3. For each tier the round enforces (Tier-S always; Tier-A if switched on):
   - **Independence:** the tier holds at least 3 projects no two of which are related.
     Checked against the proof: three project indexes, all in that tier, pairwise
     unrelated.
   - **No dominant group:** for every group g,
     `2 × Σ requested(tier ∩ g) ≤ Σ requested(tier)`. (Exactly half is allowed.)

A revision is judged on its own like any ballot. The quiet ending's settled-tier rule
(`tier_settled`) still applies on top.

### Why a proof

"At least 3 projects with no shared group" is a search over combinations; on-chain with
~80 projects it costs too much gas per ballot. Checking three named projects is cheap.
So the sender attaches, per enforced tier, three project indexes. The page (or the
relayer, or anyone) computes them; the voter never sees them. The proof is **not
signed**: it adds no meaning, it only shows the ballot is valid. Any correct proof works.

If no proof exists the ballot is invalid. A wrong proof for a valid ballot is the
sender's bug: the page always computes one when one exists.

## Contract (`vote/contracts`)

A new round deploys a new contract. The site moves to it outright: no second code path
for the old Sepolia round (closed 7 November), whose ABI and `slugs: string[]` manifest
are replaced in place. The printed Devcon codes keep working in new test rounds (they
are signed by the issuer, not tied to a contract). *(My call.)*

- **Groups.** `addGroup(bytes32 name) returns (uint8 id)`, at most 256 groups, emits
  `GroupAdded(id, name)`. Each project stores a `uint256 groups` bitmask. Related means
  `groupsA & groupsB != 0`. This is the "pre-grouping": the deploy script turns tags into
  groups once, so Solidity only ANDs masks.
- **Projects.** `Initiative` gains `bool rfp` and `uint256 groups`.
  `addInitiative(account, askUsd, rfp, groups)`; `rfp && groups != 0` reverts.
  `InitiativeConfigured` carries the new fields.
- **Adding during the vote.** `addInitiative` and `addGroup` are allowed before voting
  opens, and after it opens only when no tier is inside its quiet-ending span: for every
  tier t, not `firstTallyAt[t] ≤ now < latestSettlementAt(t)`; and never at or after
  `hardDeadline`. `MAX_PROJECTS` (254) still applies.
- **Frozen when voting opens:** an existing project's account, ask, `rfp` and `groups`
  (`setInitiative` stays setup-only), group names, and the enforced-tiers setting. So a
  later addition can never change an earlier ballot's validity.
- **Enforced tiers.** `setIndependentTiers(uint8 mask)` (bit 0 = Tier-S, bit 1 = Tier-A;
  Tier-B is never enforced), setup-only. Default Tier-S.
- **Ballot length.** A ballot may be shorter than the current project count; the missing
  trailing projects read as unplaced (255). Length must be at least 1 and at most `m`.
  This way a ballot signed just before a project is added still records, and old ballots
  stay meaningful.
- **Validation.** `_validateBallot` checks shape, minimum size, independence (proof) and
  dominant groups, reverting with a specific error per rule (e.g. `TooFewIndependent`,
  `GroupOverHalf(group)`, `BallotTooSmall`, `TooManyTiers`, `BadProof`) so the relayer
  and wallet sends can say what is wrong.
- **Entry points** gain the proof: `vote(tokenId, nonce, ballot, proof)`,
  `recordFor(…, proof)`, and the `Vote` struct gets a `proof` field. Proof type:
  `uint8[]`, three indexes per enforced tier, Tier-S first. The EIP-712 digest is
  unchanged (it binds the ballot hash only).
- **Blob ballots** (`recordBlob`) carry only a ballot hash, so the contract cannot check
  them. The replay checks every ballot (next section), which covers blobs.

## Tally / replay

- `shared/vote/rules.ts`: `checkBallot(ballot, projects, poolUsd, enforced) → { ok, errors,
  proof }` where `projects[i] = { askUsd, rfp, groups: string[] }`. Errors are structured
  (rule, tier, the projects and group involved) so the page can write messages. `proof`
  is a valid proof when one exists. Pure, browser and Deno.
- Python reference `vote/reference/ballot_rules.py`, with parity fixtures generated like
  `stage-tally.json`, and a Solidity test suite over the same fixtures. All three must
  agree.
- `replay` (`shared/vote/quiet-ending.ts`) refuses an invalid ballot with a new rejection
  reason `invalid_ballot`, judged with the projects and pool **as of that receipt's
  block**. Same effect as `tier_settled`: an earlier accepted ballot keeps counting; a
  badge with none has not voted. Contract-recorded ballots already passed; the check is
  what makes blob ballots and any contract bug safe.
- The replay needs project additions and pool changes in order: `InitiativeConfigured`,
  `GroupAdded` and `PoolUsdSet` events, read alongside ballots and burns. Short ballots are
  padded with 255 to the project count at that point.
- A project added after a tier settled is unplaced on every earlier ballot, so it never
  disturbs the settled-tier comparison.

## Round file and deploy

- The manifest's project list becomes objects: `{ slug, askUsd, rfp, tags }`, plus
  `independentTiers`. The list is **append-only**; a project's index never changes.
- `deno task vote-deploy` builds groups from the initiatives' tags (one group per distinct
  tag, named by the tag) and registers them with the projects.
- New: `deno task vote-deploy --add <slug>…` sends `addGroup` for any new tag and
  `addInitiative` for each slug, refuses inside a quiet-ending span (saying when the next
  gap opens), appends to the manifest, and the app is redeployed. Until the app redeploys,
  the page encodes ballots against the shorter list, which the contract accepts.

## Tags on initiatives (site)

- `Initiative` gets `tags: string[]` (KV and content front matter `tags:`). Admin edit form
  only. Saving tags on an RFP is refused ("RFPs can't have tags").
- Tags are not shown on cards, initiative pages, the board, the site `/llms.txt`,
  `/initiatives.json` or the `.md` facts. They appear only in ballot errors and in
  `/vote/llms.txt`. (They are in the shipped round file, so they are not secret: hiding
  them is a presentation choice.)
- Tag text: trimmed, 1–32 characters, compared case-insensitively, shown as first written.

## The ballot page

**Prefill.** When this badge has no counted ballot and this browser has no saved draft,
the editor opens with the badge's own ratings applied (5★ S, 4★ A, 3★ B). Ratings come
from `/api/reviews/ratings?tokenId=<badge>` (`mine`). A ballot that already counts, or a
draft, always wins over ratings.

Whose ratings: in the real vote the voting badge *is* the review badge, so it is that
badge's own ratings. In a test round the badge is a Sepolia test badge whose number means
nothing to reviews, so the ratings come from the review badge held by the **signed-in
account** (its lowest token id if it holds several); without one, the ballot starts
empty. Every test vote includes private badge holders, so the rehearsal exercises the
prefill. *(The user's decision.)* *(My call: no "reset to my ratings" button.)*

**Rules on the page.** `checkBallot` runs on every change. When it fails:

- **Send my ballot** and **Send it yourself** are disabled.
- A rules box in the tier column, above the send box (above the tiers on a phone,
  like "Your share"), lists each problem in plain words, for example:
  - "Tier-S needs at least 3 independent projects. Seal Audits and Seal Tooling are
    related to Seal, so they count as one."
  - "Projects related to Seal take $310,000 of Tier-S's $500,000. One related group can
    hold at most half."
  - "Your ballot requests $1,100,000. It must request at least $1,369,866 (1.5× the
    $913,244 pool). Add more projects; Tier-B is a good place for them."
- When it passes, no box (no "valid ✓" noise).

**Instructions** (the header copy): what each tier means, that anything unplaced gets
nothing and its share returns to the DAO, and an explicit nudge: "Put every project you'd
be glad to see funded in Tier-B: it only takes money once Tier-S and Tier-A are done."
The copy must describe the algorithm exactly as implemented (no tail, no checkbox).

**Relayer** (`POST /api/vote/ballot`) runs `checkBallot` and refuses an invalid ballot
(422 `invalid_ballot`, with the errors), computes the proof itself, and sends it. Self-send
from the wallet uses the page's proof.

## Paste a ballot (pabutools, Blossom ties)

**Format.** A Pabulib `.pb` text with one vote, project ids = slugs, `vote_type ordinal`,
plus the Blossom tie extension: in the `vote` cell, projects of equal rank are joined
with `=`, and groups are separated by `,` in order — Tier-S first.

```
META
key;value
description;TheDAO vote ballot
vote_type;ordinal
blossom_ties;1
PROJECTS
project_id;cost;name
formally-verified-evm;250000;Formally verified EVM
vyper-verified-compilation;180000;Vyper verified compilation
…
VOTES
voter_id;vote
1;formally-verified-evm=vyper-verified-compilation=community-fuzzing,forensiq,dappfence=wallet-security
```

That reads: Tier-S = three projects, Tier-A = `forensiq`, Tier-B = `dappfence`,
`wallet-security`. Everything not listed is unplaced.

- The page also accepts just the vote string on its own line.
- `PROJECTS`/`META` in a pasted file are informational: costs and names never override
  the round. Unknown slugs, a project listed twice, or more than three groups are errors
  shown before anything changes.
- **Paste replaces the draft only**; it never sends. Settled tiers stay as counted (the
  existing sync), and the page says so if the paste tried to change them.
- **Copy my ballot** writes the same format, so a voter can hand their current ballot to an
  LLM and paste the answer back.
- Ordinary pabutools ordinal parsers read `a=b` as one unknown project id; compatibility
  is only with the Blossom profile. The README says so.

## `/vote/llms.txt`

Plain text, llms.txt conventions like the site's `/llms.txt` (`# Title`, `> summary`,
sections), served by the API with the same caching. For the deployed round:

- What the vote is, the pool, the dates, and how the tally spends a share, in the same
  words as the page.
- The rules, exactly as above, including the 1.5× number in dollars.
- The paste format with an example.
- Every project in the round: slug, title, type (RFP/grant), requested amount, remaining
  need, tags, and a link to its `.md` page.
- An instruction for the LLM: ask the voter for their ratings or priorities (it can't
  see them), produce one vote line that satisfies the rules, and list which three Tier-S
  projects make it independent.

The ballot page links to it ("Build your ballot with an LLM") next to Paste and Copy.
*(My call: served for test rounds too, since the round file is public anyway.)*

## Docs to update

- `vote/README.md` (published mechanism, contract requirements) and the Python reference
  docs: the new rules, groups, proofs, additions during the vote.
- `vote/docs/withholding.md` describes an optional withholding choice and "today"
  leftover going to unplaced projects; mark it historical so no voter-facing text implies
  a checkbox or a tail. The user has uncommitted edits in `vote/`: build on them, never
  overwrite.
- The ballot page links to blossom.software/budgeting, which is outside this repo. Check
  that it matches (no tail, no C tier) or link to our own explanation instead.

## Out of scope

- Re-judging recorded ballots when a project is added (validity is fixed when recorded).
- Showing tags anywhere else, or letting voters see/suggest tags.
- Changing the stage tally math, the quiet ending, or per-badge share accounting.
- Fixing the empty-Tier-A lossiness of the on-chain encoding (with Tier-A enforced it
  can't arise; with Tier-S only, an empty Tier-A just shifts Tier-B up, as today).

## Open

- Whether Tier-A is enforced: decided per round before deploy (`independentTiers`).
