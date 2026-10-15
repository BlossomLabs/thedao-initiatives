"""Reference implementation of the PB Expanding Approvals Rule (PB-EAR).

Aziz & Lee, "Proportionally Representative Participatory Budgeting with Ordinal
Preferences" (AAAI-21), Algorithm 1, with the uniform fractional reweighting of
Aziz & Lee, "The expanding approvals rule" (SCW 2019).

This module uses integer arithmetic with the following fixed conventions:

* budget L == total weight n, so a project's threshold is exactly its cost;
* a ballot is a list with one competition rank per project (0 = unranked, which
  becomes the last tier);
* among eligible projects the one with the highest support wins, then the lowest
  cost, then the lowest id;
* reweighting deducts exactly the cost from the supporters using cumulative
  rounding in voter order.

A voter whose ballot is ``None`` never supports anything; its weight, like the
``abstaining`` amount, only enlarges the budget.
"""

import json
import sys


def validate_ballot(ranks, m):
    if len(ranks) != m:
        raise ValueError("ballot length must equal the number of projects")
    counts = [0] * (m + 1)
    for r in ranks:
        if r < 0 or r > m:
            raise ValueError("rank out of range")
        counts[r] += 1
    seen = 0
    for r in range(1, m + 1):
        if counts[r] and r != seen + 1:
            raise ValueError("ranks must form a competition ranking")
        seen += counts[r]


def effective_ranks(ranks):
    default = 1 + sum(1 for r in ranks if r)
    return [r or default for r in ranks]


def cumulative_deductions(weights, thr, total=None, start=0):
    """Deduct ``thr`` from ``weights`` in proportion, integer-exact.

    ``total`` is the whole support behind the funded project and defaults to the sum of
    ``weights``; ``start`` is the cumulative weight already accounted for ahead of the
    first entry. Transcript generation runs the public block first, so replaying only
    the sealed block passes the transcript's ``total`` with ``start = pubSupport[best]``, and gets
    the same deductions as one pass over both blocks. With the defaults the deductions
    sum to exactly ``thr``.
    """
    if total is None:
        total = sum(weights)
    deductions = []
    cum = start
    for w in weights:
        new_cum = cum + w
        deductions.append(new_cum * thr // total - cum * thr // total)
        cum = new_cum
    return deductions


def pbear(costs, voters, abstaining=0):
    m = len(costs)
    weights = [w for w, _ in voters]
    ranks = []
    for _, ballot in voters:
        if ballot is None:
            ranks.append(None)
        else:
            validate_ballot(ballot, m)
            ranks.append(effective_ranks(ballot))
    budget = sum(weights) + abstaining
    funded = []
    is_funded = [False] * m
    spent = 0
    level = 1

    def exhausted():
        return all(is_funded[c] or spent + costs[c] > budget for c in range(m))

    while not exhausted():
        support = [0] * m
        for i, r in enumerate(ranks):
            if r is None or weights[i] == 0:
                continue
            for c in range(m):
                if not is_funded[c] and r[c] <= level:
                    support[c] += weights[i]
        best = None
        for c in range(m):
            if is_funded[c] or support[c] < costs[c]:
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
        is_funded[best] = True
        funded.append(best)
        spent += costs[best]
    return funded


NONE = 2**64 - 1


def _ranks_of(entries, m):
    out = []
    for _, ballot in entries:
        if ballot is None:
            out.append(None)
        else:
            validate_ballot(ballot, m)
            out.append(effective_ranks(ballot))
    return out


def _support(weights, ranks, indices, is_funded, level, m):
    support = [0] * m
    for i in indices:
        r = ranks[i]
        if r is None or weights[i] == 0:
            continue
        for c in range(m):
            if not is_funded[c] and r[c] <= level:
                support[c] += weights[i]
    return support


def _argmax(costs, support, is_funded):
    best = None
    for c in range(len(costs)):
        if is_funded[c] or support[c] < costs[c]:
            continue
        if best is None or support[c] > support[best] or (
            support[c] == support[best] and costs[c] < costs[best]
        ):
            best = c
    return best


def pbear_transcript(costs, public, sealed, budget):
    """PB-EAR over the public block followed by the sealed block, with one transcript
    record per executed step: [level, pubSupport..., best, total]."""
    m = len(costs)
    entries = list(public) + list(sealed)
    n_pub = len(public)
    weights = [w for w, _ in entries]
    if sum(weights) > budget:
        raise ValueError("entry weights exceed the budget")
    ranks = _ranks_of(entries, m)
    pub_idx = range(0, n_pub)
    sealed_idx = range(n_pub, len(entries))
    funded, is_funded, spent, level, transcript = [], [False] * m, 0, 1, []

    def exhausted():
        return all(is_funded[c] or spent + costs[c] > budget for c in range(m))

    while not exhausted():
        pub = _support(weights, ranks, pub_idx, is_funded, level, m)
        sea = _support(weights, ranks, sealed_idx, is_funded, level, m)
        total_support = [pub[c] + sea[c] for c in range(m)]
        best = _argmax(costs, total_support, is_funded)
        if best is None:
            transcript.append([level] + pub + [NONE, 0])
            if level >= m:
                break
            level += 1
            continue
        total = total_support[best]
        transcript.append([level] + pub + [best, total])
        supporters = [i for i in range(len(entries)) if ranks[i] is not None and weights[i] and ranks[i][best] <= level]
        for i, d in zip(supporters, cumulative_deductions([weights[i] for i in supporters], costs[best])):
            weights[i] -= d
        is_funded[best] = True
        funded.append(best)
        spent += costs[best]
    # At most one funding step per project and at most one NONE step per level, and
    # levels run from 1 to m, so the transcript has at most 2m steps.
    assert len(transcript) <= 2 * m
    return funded, transcript


def replay_public(costs, public, transcript, budget):
    """Replay the public block against a transcript using
    only public data. True iff every public support vector, level, funding and
    deduction is consistent. Cannot judge `best` against sealed support."""
    m = len(costs)
    weights = [w for w, _ in public]
    try:
        ranks = _ranks_of(public, m)
    except ValueError:
        return False
    is_funded, spent, level = [False] * m, 0, 1

    def exhausted():
        return all(is_funded[c] or spent + costs[c] > budget for c in range(m))

    for step in transcript:
        if len(step) != m + 3 or exhausted():
            return False
        s_level, pub, best, total = step[0], step[1 : m + 1], step[m + 1], step[m + 2]
        if s_level != level:
            return False
        if pub != _support(weights, ranks, range(len(public)), is_funded, level, m):
            return False
        if best == NONE:
            if total != 0 or any(not is_funded[c] and pub[c] >= costs[c] for c in range(m)):
                return False
            if level >= m:
                level = None  # terminal; any further step is invalid
                continue
            level += 1
            continue
        if level is None or not 0 <= best < m or is_funded[best]:
            return False
        if total < costs[best] or total < pub[best] or spent + costs[best] > budget:
            return False
        supporters = [i for i in range(len(public))
                      if ranks[i] is not None and weights[i] and ranks[i][best] <= level]
        for i, d in zip(supporters, cumulative_deductions(
            [weights[i] for i in supporters], costs[best], total
        )):
            weights[i] -= d
        is_funded[best] = True
        spent += costs[best]
    if level is None:
        return True
    return exhausted()


def is_exhaustive(costs, budget, funded):
    spent = sum(costs[c] for c in funded)
    return all(c in funded or spent + costs[c] > budget for c in range(len(costs)))


def _subsets(items):
    n = len(items)
    for mask in range(1, 1 << n):
        yield [items[i] for i in range(n) if mask >> i & 1]


def is_ipsc(costs, budget, voters, funded):
    """Brute-force check of Inclusion PSC (Definition 5) with L == n == budget."""
    m = len(costs)
    active = [(w, effective_ranks(b)) for w, b in voters if b is not None and w]
    projects = list(range(m))
    funded_set = set(funded)
    for coalition in _subsets(active):
        b_coalition = sum(w for w, _ in coalition)
        for c_prime in _subsets(projects):
            outside = [c for c in projects if c not in c_prime]
            solid = all(
                all(r[cp] <= r[co] for cp in c_prime for co in outside) for _, r in coalition
            )
            if not solid:
                continue
            k = len(c_prime)
            periphery = {c for _, r in coalition for c in projects if r[c] <= k}
            pw = periphery & funded_set
            pw_cost = sum(costs[c] for c in pw)
            for c_star in c_prime:
                if c_star in pw:
                    continue
                if costs[c_star] + pw_cost <= b_coalition:
                    return False
    return True


def abi_encode_uint_array(values):
    words = [0x20, len(values)] + list(values)
    return "0x" + "".join(format(v, "064x") for v in words)


def main(argv):
    if len(argv) > 2 and argv[1] == "--transcript":
        payload = json.loads(argv[2])
        funded, transcript = pbear_transcript(
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
    funded = pbear(costs, voters, abstaining)
    budget = sum(w for w, _ in voters) + abstaining
    result = [
        int(is_ipsc(costs, budget, voters, funded)),
        int(is_exhaustive(costs, budget, funded)),
    ] + funded
    print(abi_encode_uint_array(result))


if __name__ == "__main__":
    main(sys.argv)
