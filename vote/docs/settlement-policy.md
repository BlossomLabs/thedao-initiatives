# USD pool and tier settlement

The round uses firm USD settlements, one each for S-Tier, A-Tier and B-Tier. Each tier uses current
historical asks and the shares left after earlier settlements. The complete
[voting rules](quiet-ending-rules.md) define the process.

- The pool records secured USD. Before S-Tier's first tally it may be corrected; afterwards it only
  increases. The contract records funding assertions and does not hold or pay the funds.
- First ballots count until S-Tier actually settles. Then the accepted NFT roll freezes. For N
  registered badges and pool P, each entitlement is `floor(P / N)`; remaining share is that
  entitlement minus fixed settled charges. An increase adds the difference between the old and new
  entitlements. The rounding remainder stays unallocated. With no registered badges, nothing is
  allocated.
- Each tally reads the contract's asks and pool at its own canonical block. The closing tally uses
  the last block strictly before the cutoff. Stored-price fallbacks, failed balance reads and
  retained token precision are exposed as valuation diagnostics without changing the contract's
  conversion rules.
- Settlement fixes USD awards and per-badge charges. Replay recomputes them from historical inputs;
  a cached result cannot choose an outcome or settlement time.
- Settled outcomes govern subsequent revisions at their scheduled cutoff. They are labelled as
  awaiting chain finality until a finalized block reaches that cutoff. Elapsed time alone never
  confirms them.
- Later donations, withdrawals, prices, pledge changes and goal corrections do not reduce awards or
  create automatic top-ups. A project covered at settlement receives a zero award and does not
  return in a later tier. Unsettled initiatives use current asks and remaining shares.
- Fixed awards and current asks are shown separately. Coverage comparisons assume awards have not
  yet been paid; a pool payout must not be double-counted as outside support. A supplemental funding
  process requires separate funds and rules.

Firm settlements can produce a different allocation from a fresh PB-EAR tally of all final inputs.
For example, a $60 award from a $100 pool stays $60 after a later $50 donation, leaving $40 for
subsequent tiers. A fresh tally might fund both that initiative's $10 remaining ask and another
initiative asking $60. The round accepts this tradeoff to give earlier settlements finality. The
fixed-input proportionality guarantee does not automatically apply to the changing-input process.
