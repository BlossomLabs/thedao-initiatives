# USD pool and tier settlement

Decision recorded 15 October 2026: adopt **fixed_usd**. Replay locks USD awards at
settlement, rather than freezing economic inputs at a tier's first tally (tier_lock).

- **Funding:** record actual net USD conversion proceeds or an enforceable guarantee
  in the award currency. Oracle valuation does not secure funding. The total may
  increase but never decrease.
- **Timing:** admins set future dates independently, with nonoverlapping windows
  checked at deployment and on updates. Initial funding must be recorded strictly
  before S's first tally; it never moves dates. If funding is missing, registration
  stays open and admins must explicitly reschedule S before setting it. Started
  opening and funded tier dates cannot change. An explicit zero initializes funding;
  the default zero does not.
- **Shares:** registration closes at S plus the initial window, fixing the accepted
  NFT count and equal initial shares. Later increases add equally to those NFTs'
  remaining shares without changing settled awards or charges. Exact rounding remains open.
- **Provisional tallies:** at each historical cutoff, project need is
  `max(askUSD - donationsUSD - outstandingPledgesUSD, 0)`. USD pledges retain their
  outstanding dollar amount; other denominations must be explicit. Valuing balances
  does not exchange tokens.
- **Settlement:** replay fixes USD awards and per-NFT charges at the tally that
  finalizes the tier. Earlier tallies commit no money. Later prices, donations,
  withdrawals or pledge corrections neither reprice awards nor trigger top-ups.
  Resulting project gaps or excess coverage are outside that decision. Unsettled
  tiers use current needs and remaining shares, including added funding.

Material increases in project need or per-NFT payment burden must prevent quiet
agreement, even when payment proportions stay unchanged. Precise thresholds
and implementation remain open; maximum windows and forced closure still apply.

**Accepted tradeoff:** results may differ from a fresh PB-EAR tally of final inputs;
its proportionality guarantee does not automatically extend to this process.

**Implementation:** the contract records funding, enforces its initial deadline and
validates date changes; increases remain allowed until the maximum end. It does not execute or prove funding.
Settlement, shares and checkpoints belong to replay, whose settlement and additional
quiet-comparison checks remain unimplemented. Shared tally references are unchanged.
