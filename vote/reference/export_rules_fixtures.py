"""Fixtures for the ballot rules: shared/vote/rules.ts and the contract must agree with
ballot_rules.py on every case.

    python3 -I vote/reference/export_rules_fixtures.py > shared/vote/fixtures/ballot-rules.json
"""

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ballot_rules import WITHHELD, check_ballot  # noqa: E402


def named():
    """The hand-written cases (test_ballot_rules.py) on the six-project round."""
    projects = [
        {"askUsd": ask, "rfp": i == 5, "groups": [0] if i < 2 else []}
        for i, ask in enumerate([100, 100, 100, 100, 50, 50])
    ]
    W = WITHHELD
    cases = [
        ("valid", [1, W, 1, 1, W, W], 200, 1),
        ("related count as one", [1, 1, 1, 4, 4, W], 200, 1),
        ("rfp is independent", [1, W, 1, 4, W, 1], 200, 1),
        ("exactly half", [1, 1, 1, 1, W, W], 200, 1),
        ("over half", [1, 1, 1, W, W, 1], 200, 1),
        ("size exactly 1.5x", [1, W, 1, 1, W, W], 200, 1),
        ("size short", [1, W, 1, 1, W, W], 201, 1),
        ("four tiers", [1, 2, 3, 4, W, W], 200, 1),
        ("tier-a enforced, empty", [1, W, 1, 1, W, W], 200, 3),
        ("short ballot", [1, 4, 1, 1], 200, 1),
        ("rank gap", [1, 4, 1, W, W, W], 200, 1),
    ]
    return [(name, projects, ["Seal"], pool, tiers, b) for name, b, pool, tiers in cases]


def random_case(rng, k):
    m = rng.randint(6, 30)
    n_groups = rng.randint(0, 4)
    projects = []
    for _ in range(m):
        rfp = rng.random() < 0.2
        groups = [] if rfp or not n_groups else sorted(rng.sample(range(n_groups), rng.randint(0, min(2, n_groups))))
        projects.append({"askUsd": rng.randint(1, 50) * 10_000, "rfp": rfp, "groups": groups})
    order = list(range(m))
    rng.shuffle(order)
    placed = order[: rng.randint(1, m)]
    n_tiers = rng.randint(1, min(4 if rng.random() < 0.1 else 3, len(placed)))
    cuts = sorted(rng.sample(range(1, len(placed)), n_tiers - 1)) if n_tiers > 1 else []
    ballot = [WITHHELD] * m
    rank = 1
    for a, b in zip([0] + cuts, cuts + [len(placed)]):
        for i in placed[a:b]:
            ballot[i] = rank
        rank += b - a
    if rng.random() < 0.15:  # recorded before the last projects were added
        while len(ballot) > 1 and ballot[-1] == WITHHELD:
            ballot.pop()
    requested = sum(projects[i]["askUsd"] for i in placed)
    pool = max(1, int(requested * rng.uniform(0.4, 0.9)))
    return (f"random {k}", projects, [f"G{g}" for g in range(n_groups)], pool, rng.choice([1, 1, 3]), ballot)


def main():
    rng = random.Random(2026)
    cases = named() + [random_case(rng, k) for k in range(60)]
    out = []
    for name, projects, names, pool, tiers, ballot in cases:
        r = check_ballot(ballot, projects, pool, tiers)
        out.append({
            "name": name,
            "projects": [{**p, "askUsd": str(p["askUsd"])} for p in projects],
            "groupNames": names,
            "poolUsd": str(pool),
            "independentTiers": tiers,
            "ballot": ballot,
            "ok": r["ok"],
            "rules": [e["rule"] for e in r["errors"]],
            "proof": r["proof"],
            # Flat, numbers only: what the Solidity test reads with vm.parseJson*.
            "sol": {
                "asks": [p["askUsd"] for p in projects],
                "rfp": [p["rfp"] for p in projects],
                "masks": [sum(1 << g for g in p["groups"]) for p in projects],
                "groupCount": len(names),
                "pool": pool,
            },
        })
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
