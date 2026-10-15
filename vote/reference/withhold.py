"""Withholding: a voter can keep their money away from proposals they did not place.

A ballot is the usual list of competition ranks, one per proposal, with 0 for a
proposal left unplaced. Here an unplaced proposal may instead be marked ``WITHHELD``
(255, a rank no ballot can use while there are at most 254 proposals). The tally is
PB-EAR exactly as in ``pbear``, except that a voter never supports a proposal they
withheld. Unplaced proposals that are not withheld are still the voter's tied last
tier. Whatever a voter has left at the end goes back to the funder.

This is the original algorithm on a longer ballot. Add a candidate "Return" that
every voter ranks at position m + 1, just after the longest possible ballot, with the
withheld proposals below it. To put Return at that position on a ballot with w
withheld proposals, w dummy candidates that cost more than the whole budget are ranked
just above it. Return costs whatever the voters have left when it opens, so it takes
all of it, and the withheld proposals open when nobody has any money.

``reference_tally`` is the oracle the other implementations are fuzzed against. It
uses nothing but ``pbear.py``, unchanged, on those padded ballots (``padded``).
``pbear_withhold`` is the same tally written directly, for the simulations.

    python3 reference/withhold.py '{"costs": [...], "voters": [[weight, ballot], ...], "abstaining": 0}'
    python3 reference/withhold.py --transcript '{"costs": [...], "public": [...], "sealed": [...], "budget": 0}'

print what ``pbear.py`` prints for the same arguments.
"""

import json
import sys

from pbear import (
    NONE,
    abi_encode_uint_array,
    cumulative_deductions,
    is_exhaustive,
    is_ipsc,
    pbear,
    pbear_transcript,
    validate_ballot,
)

WITHHELD = 255


def without_marks(ballot):
    """``ballot`` with its withheld proposals shown as unplaced."""
    return [0 if r == WITHHELD else r for r in ballot]


def withhold_all(ballot):
    """``ballot`` with every unplaced proposal withheld."""
    return [r or WITHHELD for r in ballot]


def ranks_of(ballot):
    """The rank level at which each proposal opens for this voter. A withheld one
    keeps its mark, a level the tally never reaches."""
    m = len(ballot)
    if m >= WITHHELD:
        raise ValueError("too many proposals for the withheld mark")
    validate_ballot(without_marks(ballot), m)
    last = 1 + sum(1 for r in ballot if r and r != WITHHELD)
    return [r or last for r in ballot]


def padded(costs, voters, abstaining=0, back=None):
    """The longer instance for plain ``pbear``: the m proposals, then as many dummies
    as the most any ballot withholds, then Return, which costs ``back`` (or, if that
    is ``None``, too much to be funded). Returns its costs and its voters."""
    m = len(costs)
    budget = sum(w for w, _ in voters) + abstaining
    most = max((sum(1 for r in b if r == WITHHELD) for _, b in voters if b is not None), default=0)
    out = []
    for weight, ballot in voters:
        if ballot is None:
            out.append((weight, None))
            continue
        ranks_of(ballot)
        withheld = sum(1 for r in ballot if r == WITHHELD)
        placed = sum(1 for r in ballot if r and r != WITHHELD)
        real = [0 if r == WITHHELD else r or placed + 1 for r in ballot]
        dummies = [m - withheld + 1 if d < withheld else 0 for d in range(most)]
        out.append((weight, real + dummies + [m + 1]))
    return list(costs) + [budget + 1] * most + [budget + 1 if back is None else back], out


def reference_transcript(costs, public, sealed, budget):
    """``pbear_transcript`` for ballots with withheld proposals: the transcript of the
    padded instance up to rank level m, with the columns of the m proposals."""
    m = len(costs)
    entries = list(public) + list(sealed)
    long_costs, long_entries = padded(costs, entries, budget - sum(w for w, _ in entries))
    width = len(long_costs)
    _, transcript = pbear_transcript(long_costs, long_entries[: len(public)], long_entries[len(public) :], budget)
    steps = [[s[0]] + s[1 : m + 1] + s[width + 1 :] for s in transcript if s[0] <= m]
    return [s[m + 1] for s in steps if s[m + 1] != NONE], steps


def reference_tally(costs, voters, abstaining=0):
    """The funded proposals in order, from ``pbear.py`` alone. Also returns the padded
    instance with Return at its cost and what plain ``pbear`` funds on it, after
    checking that this is the same proposals in the same order, no dummy, and Return
    last when there is anything to return."""
    m = len(costs)
    budget = sum(w for w, _ in voters) + abstaining
    funded, _ = reference_transcript(costs, voters, [], budget)
    back = sum(w for w, b in voters if b is not None) - sum(costs[c] for c in funded)
    long_costs, long_voters = padded(costs, voters, abstaining, back)
    outcome = pbear(long_costs, long_voters, abstaining)
    giving_back = len(long_costs) - 1
    if [c for c in outcome if c < m] != funded or any(m <= c < giving_back for c in outcome):
        raise AssertionError("plain PB-EAR on the padded ballots funds something else")
    if giving_back not in outcome or (back and outcome[-1] != giving_back):
        raise AssertionError("Return is not funded last on the padded ballots")
    return funded, (long_costs, long_voters, outcome)


def pbear_withhold(costs, voters, abstaining=0):
    """Tally ``voters`` (``(weight, ballot)`` pairs; a ``None`` ballot supports
    nothing). Returns the funded proposals in order, what each voter paid for each,
    and what each voter has left, which goes back to the funder together with the
    ``abstaining`` amount."""
    m = len(costs)
    weights = [w for w, _ in voters]
    ranks = [None if ballot is None else ranks_of(ballot) for _, ballot in voters]
    budget = sum(weights) + abstaining
    funded, paid, spent, level = [], {}, 0, 1

    def exhausted():
        return all(c in paid or spent + costs[c] > budget for c in range(m))

    while not exhausted():
        support = [0] * m
        for i, r in enumerate(ranks):
            if r is None or weights[i] == 0:
                continue
            for c in range(m):
                if c not in paid and r[c] <= level:
                    support[c] += weights[i]
        best = None
        for c in range(m):
            if c in paid or support[c] < costs[c]:
                continue
            if best is None or support[c] > support[best] or (
                support[c] == support[best] and costs[c] < costs[best]
            ):
                best = c
        if best is None:
            if level >= m:
                break
            level += 1
            continue
        supporters = [i for i, r in enumerate(ranks) if r is not None and weights[i] and r[best] <= level]
        deductions = cumulative_deductions([weights[i] for i in supporters], costs[best])
        for i, d in zip(supporters, deductions):
            weights[i] -= d
        paid[best] = dict(zip(supporters, deductions))
        funded.append(best)
        spent += costs[best]
    return funded, paid, weights


def main(argv):
    if len(argv) > 2 and argv[1] == "--transcript":
        payload = json.loads(argv[2])
        funded, transcript = reference_transcript(
            payload["costs"],
            [(w, b) for w, b in payload["public"]],
            [(w, b) for w, b in payload["sealed"]],
            payload["budget"],
        )
        print(json.dumps({"funded": funded, "transcript": transcript}))
        return
    payload = json.loads(argv[1])
    costs = payload["costs"]
    voters = [(w, b) for w, b in payload["voters"]]
    abstaining = payload.get("abstaining", 0)
    funded, (long_costs, long_voters, outcome) = reference_tally(costs, voters, abstaining)
    budget = sum(w for w, _ in voters) + abstaining
    # The proportionality check tries every group of voters and every set of
    # candidates, and the padded instance has up to twice as many candidates.
    small = sum(1 for w, b in voters if w and b is not None) <= 5
    result = [
        int(not small or is_ipsc(long_costs, budget, long_voters, outcome)),
        int(is_exhaustive(long_costs, budget, outcome)),
    ] + funded
    print(abi_encode_uint_array(result))


if __name__ == "__main__":
    main(sys.argv)
