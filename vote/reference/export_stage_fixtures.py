"""Fixtures for the site's TypeScript stage tally (shared/vote/stage.ts).

Chains the quiet ending's stage tallies the way quiet_ending_steps.run_on_time's
tally_open does: one _ear per stage, weights carried over, each stage counting to
bound(). Ballots are in on-chain form: competition ranks, 255 = withheld.

    python3 -I vote/reference/export_stage_fixtures.py > shared/vote/fixtures/stage-tally.json
"""

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from quiet_ending import _ear  # noqa: E402
from quiet_ending_steps import tier_levels  # noqa: E402

WITHHELD = 255
TIERS = 3


def ballot(rng, m):
    """1..3 tiers of distinct proposals, the rest withheld, as competition ranks."""
    order = list(range(m))
    rng.shuffle(order)
    placed = order[: rng.randint(1, m)]
    groups = rng.randint(1, min(3, len(placed)))
    cuts = sorted(rng.sample(range(1, len(placed)), groups - 1)) if groups > 1 else []
    tiers = [placed[a:b] for a, b in zip([0] + cuts, cuts + [len(placed)])]
    out, above = [WITHHELD] * m, 0
    for tier in tiers:
        for c in tier:
            out[c] = above + 1
        above += len(tier)
    return out


def bound(ballots, stage, m):
    if stage >= TIERS:
        return m
    plain = [[0 if r == WITHHELD else r for r in b] for b in ballots]
    highest = 1
    for level in tier_levels(plain, TIERS)[: stage + 1]:
        highest = highest if level is None else max(highest, level)
    return highest


def case(rng):
    m = rng.randint(3, 8)
    n = rng.randint(2, 12)
    costs = [rng.randint(1, 10**6) for _ in range(m)]
    pool = rng.randint(sum(costs) // 3, sum(costs) * 2)
    weights = [pool // n] * n
    ballots = [ballot(rng, m) for _ in range(n)]
    # _ear's ranks: withheld sits above every level, so it never opens.
    ranks = [[m + 1 if r == WITHHELD else r for r in b] for b in ballots]
    held, done, spent, stages = list(weights), set(), 0, []
    for stage in range(TIERS + 1):
        candidates = [c for c in range(m) if c not in done]
        order, shares, _ = _ear(costs, held, ranks, pool, spent, candidates, max_level=bound(ballots, stage, m))
        done |= set(order)
        spent += sum(sum(shares[c].values()) for c in order)
        stages.append({
            "order": order,
            "bound": bound(ballots, stage, m),
            "shares": {str(c): {str(i): str(d) for i, d in shares[c].items()} for c in order},
        })
    return {
        "costs": [str(c) for c in costs],
        "weights": [str(w) for w in weights],
        "budget": str(pool),
        "ballots": ballots,
        "stages": stages,
    }


rng = random.Random(7)
json.dump([case(rng) for _ in range(40)], sys.stdout, indent=1)
print()
