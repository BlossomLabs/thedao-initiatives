"""Withholding on the simulated rounds of `quiet_ending_sim`: the 49 initiatives of
TheDAO Security Fund, a $1,000,000 pool and 200 invented badge holders, with the
ballots as they stand at the deadline.

    python3 reference/withhold_sim.py [rounds]
"""

import random
import sys

from pbear import pbear
from quiet_ending_sim import POOL, World, mean
from withhold import WITHHELD, pbear_withhold


def keep_open(world, i, ballot, count):
    """Holder i's ballot with every unplaced proposal withheld except the `count` it
    likes best."""
    unplaced = sorted((c for c in range(world.m) if not ballot[c]), key=lambda c: -world.utility[i][c])
    return [WITHHELD if c in unplaced[count:] else r for c, r in enumerate(ballot)]


SCENARIOS = [
    ("nobody withholds (today)", lambda world, i, ballot, rng: ballot),
    ("a quarter withhold everything", lambda world, i, ballot, rng: keep_open(world, i, ballot, 0) if rng.random() < 0.25 else ballot),
    ("half withhold everything", lambda world, i, ballot, rng: keep_open(world, i, ballot, 0) if rng.random() < 0.5 else ballot),
    ("everyone keeps 10 open", lambda world, i, ballot, rng: keep_open(world, i, ballot, 10)),
    ("everyone keeps 5 open", lambda world, i, ballot, rng: keep_open(world, i, ballot, 5)),
    ("everyone withholds everything", lambda world, i, ballot, rng: keep_open(world, i, ballot, 0)),
]


def play(world, choose):
    rng = random.Random(f"{world.seed}/withhold")
    present = [a is not None and a <= 1 for a in world.arrival]
    share = POOL // sum(present)
    voters = [(share, choose(world, i, world.ballot(i), rng)) if present[i] else (0, None) for i in range(world.n)]
    funded, paid, left = pbear_withhold(world.costs, voters, POOL - share * sum(present))
    unplaced = sum(d for c in funded for i, d in paid[c].items() if not voters[i][1][c])
    carried = sum(1 for c in funded if 2 * sum(d for i, d in paid[c].items() if not voters[i][1][c]) > world.costs[c])
    return funded, unplaced / 10**6, carried, voters


def main(rounds):
    print("Withholding, by what the holders do with the proposals they did not place:")
    print("  holders                          funded  spent       returned   paid for unplaced proposals  funded mostly by them  lost / gained vs today  equal to plain PB-EAR")
    today = {}
    for label, choose in SCENARIOS:
        rows = []
        for seed in range(rounds):
            world = World(seed)
            funded, unplaced, carried, voters = play(world, choose)
            today.setdefault(seed, funded)
            plain = pbear(world.costs, [(w, b and [0 if r == WITHHELD else r for r in b]) for w, b in voters], POOL - sum(w for w, _ in voters))
            rows.append(
                (
                    len(funded),
                    world.dollars(funded),
                    POOL / 10**6 - world.dollars(funded),
                    unplaced,
                    carried,
                    len(set(today[seed]) - set(funded)),
                    len(set(funded) - set(today[seed])),
                    funded == plain,
                )
            )
        print(
            f"  {label:31}  {mean(r[0] for r in rows):6.1f}  ${mean(r[1] for r in rows):8,.0f}  ${mean(r[2] for r in rows):8,.0f}"
            f"  ${mean(r[3] for r in rows):8,.0f}                    {mean(r[4] for r in rows):6.2f}"
            f"                 {mean(r[5] for r in rows):4.1f} / {mean(r[6] for r in rows):3.1f}             {sum(r[7] for r in rows)}/{rounds}"
        )


def main_one_holder(rounds):
    """Does a single holder do worse by withholding everything it did not place?"""
    better = worse = same = tried = 0
    for seed in range(rounds):
        world = World(seed)
        base = play(world, SCENARIOS[0][1])[0]
        rng = random.Random(seed)
        present = [i for i in range(world.n) if world.arrival[i] is not None and world.arrival[i] <= 1]
        for holder in rng.sample(present, 12):
            funded = play(world, lambda w, i, ballot, r: keep_open(w, i, ballot, 0) if i == holder else ballot)[0]
            placed = {c for c in range(world.m) if world.ballot(holder)[c]}
            before, after = world.dollars(set(base) & placed), world.dollars(set(funded) & placed)
            tried += 1
            better += after > before
            worse += after < before
            same += after == before
    print(f"\nOne holder alone withholding everything it did not place ({tried} tries):")
    print(f"  more of what it placed is funded: {better}   less: {worse}   the same: {same}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_one_holder(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
