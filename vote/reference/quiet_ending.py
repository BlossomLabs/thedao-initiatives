"""Model of the Quiet Ending extension on top of PB-EAR, for studying its properties.

Quiet Ending settles the proposals whose result held through a window: funded ones are
locked in, unfunded ones are locked out, and only the rest stay contested while voting
is extended. The proposal text does not say who pays for a locked-in proposal when the
tally runs again, so this module models three readings and the tests compare them:

``reset``   The literal reading. Locked-in proposals take their cost off the budget and
            the contested proposals are tallied with every voter at full weight.
``replay``  The whole tally runs again on the final ballots. Locked-out proposals can
            never be funded, money is reserved so that every locked-in proposal still
            fits, and a locked-in proposal the ballots no longer fund is paid at the end
            from whatever weight is left. Supporters are charged as PB-EAR charges them,
            but according to the ballots as they stand now.
``frozen``  What each voter paid for a proposal is recorded when the proposal is locked
            in and never changes. Extensions tally only the contested proposals, with
            every voter starting from what they have left.

The ``replay`` rule lets a voter stop paying for a locked-in proposal by taking it off
the ballot. ``pin_settled`` is the companion that prevents it: during an extension a
ballot may move only the contested proposals.

Voters are ``(weight, ballot)`` in a fixed order, as in ``pbear``; a voter without a
ballot has ``None`` and its weight only enlarges the budget.
"""

from pbear import cumulative_deductions, effective_ranks, validate_ballot

RULES = ("reset", "replay", "frozen")


def _ranks(voters, m):
    out = []
    for _, ballot in voters:
        if ballot is None:
            out.append(None)
        else:
            validate_ballot(ballot, m)
            out.append(effective_ranks(ballot))
    return out


def _ear(costs, weights, ranks, budget, spent, candidates, reserved=(), max_level=None):
    """Expanding approvals over ``candidates``, starting from ``weights`` and ``spent``.

    Mutates ``weights``. ``reserved`` are candidates that must end up funded: nothing
    else is funded unless they would all still fit, and any the ballots leave unfunded
    is paid at the end by everyone with a ballot (and by abstaining weight if that is
    not enough). Returns the funding order, what each voter paid for each project, and
    the reserved projects that had to be paid that way.

    Support is kept up to date as levels open and weight is spent, instead of being
    recounted at every step as ``pbear`` does; the arithmetic is the same.
    ``max_level`` stops the tally once nothing more can be funded at that rank level.
    """
    m = len(costs)
    last_level = m if max_level is None else min(m, max_level)
    candidates = sorted(candidates)
    opens = [[] for _ in range(m + 2)]
    for i, r in enumerate(ranks):
        if r is not None:
            for c in candidates:
                opens[r[c]].append((i, c))
    approved = [[] for _ in ranks]
    approvers = {c: [] for c in candidates}
    support = {c: 0 for c in candidates}
    funded, done, paid, forced = [], set(), {}, []

    def open_level(level):
        for i, c in opens[level]:
            approved[i].append(c)
            approvers[c].append(i)
            support[c] += weights[i]

    def pay(c, payers, amount):
        deductions = cumulative_deductions([weights[i] for i in payers], amount) if amount else []
        paid[c] = {}
        for i, d in zip(payers, deductions):
            weights[i] -= d
            paid[c][i] = d
            for other in approved[i]:
                support[other] -= d
        done.add(c)
        funded.append(c)

    level = 1
    open_level(1)
    while True:
        owed = sum(costs[r] for r in reserved if r not in done)
        room = budget - spent - owed
        fitting = [c for c in candidates if c not in done and costs[c] <= room + (costs[c] if c in reserved else 0)]
        if not fitting:
            break
        best = None
        for c in fitting:
            if support[c] < costs[c]:
                continue
            if best is None or support[c] > support[best] or (
                support[c] == support[best] and costs[c] < costs[best]
            ):
                best = c
        if best is None:
            if level >= last_level:
                break
            level += 1
            open_level(level)
            continue
        pay(best, sorted(i for i in approvers[best] if weights[i]), costs[best])
        spent += costs[best]

    for c in sorted(reserved):
        if c in done:
            continue
        payers = [i for i, r in enumerate(ranks) if r is not None and weights[i]]
        pay(c, payers, min(sum(weights[i] for i in payers), costs[c]))
        forced.append(c)
        spent += costs[c]
    return funded, paid, forced


def tally(costs, voters, abstaining=0, rule="replay", locked_in=(), locked_out=(), charges=None):
    """Tally ``voters`` with the settled proposals held fixed, under ``rule``.

    ``charges`` maps a voter's index to what it already paid for locked-in proposals;
    only the ``frozen`` rule reads it. With nothing settled every rule is plain PB-EAR.
    Returns ``(funded, paid, forced)`` as ``_ear`` does, ``funded`` listing the
    locked-in proposals first for the rules that do not tally them.
    """
    m = len(costs)
    weights = [w for w, _ in voters]
    ranks = _ranks(voters, m)
    budget = sum(weights) + abstaining
    locked_in, locked_out = list(locked_in), set(locked_out)
    alive = [c for c in range(m) if c not in locked_out]
    contested = [c for c in alive if c not in locked_in]
    if rule == "replay":
        return _ear(costs, weights, ranks, budget, 0, alive, reserved=locked_in)
    spent = sum(costs[c] for c in locked_in)
    if rule == "frozen":
        for i, d in (charges or {}).items():
            weights[i] -= d
    elif rule != "reset":
        raise ValueError(rule)
    funded, paid, forced = _ear(costs, weights, ranks, budget, spent, contested)
    return locked_in + funded, paid, forced


def run_round(costs, profiles, abstaining=0, rule="replay", max_extensions=None):
    """Play a round. ``profiles[0]`` is the ballots when the quiet window opens,
    ``profiles[1]`` at the deadline, and each later one at the end of an extension.

    ``profiles`` may instead be a function ``(k, contested, funded) -> (voters,
    abstaining)`` that produces checkpoint ``k`` knowing what is contested and funded
    going into it, so that simulated voters can respond; ``max_extensions`` is then
    required. Voters keep their position from one checkpoint to the next, but their
    weights may change; a frozen charge then scales with the voter's weight.

    Returns a dict with the final ``funded`` list, the number of ``extensions`` run,
    ``contested`` (the contested set announced at each checkpoint), the final
    ``locked_in`` and ``locked_out``, and from the last tally the ``voters``, what they
    ``paid``, the ``charges`` frozen before it and the ``forced`` proposals.
    """
    m = len(costs)
    if callable(profiles):
        profile = profiles
    else:
        if max_extensions is None:
            max_extensions = len(profiles) - 2
        last = len(profiles) - 1

        def profile(k, contested, funded):
            return profiles[min(k, last)], abstaining

    contested = set(range(m))
    voters, loose = profile(0, sorted(contested), [])
    funded = tally(costs, voters, loose)[0]
    snapshot = set(funded)
    locked_in, locked_out, receipts = [], set(), {}
    history = []
    k = 0
    while True:
        voters, loose = profile(k + 1, sorted(contested), funded)
        charges = {
            i: min(voters[i][0], sum(d * voters[i][0] // then for d, then in parts)) for i, parts in receipts.items()
        }
        funded, paid, forced = tally(costs, voters, loose, rule, locked_in, locked_out, charges)
        result = set(funded)
        flipped = {c for c in contested if (c in result) != (c in snapshot)}
        for c in funded:
            if c in contested and c not in flipped:
                locked_in.append(c)
                for i, d in paid.get(c, {}).items():
                    receipts.setdefault(i, []).append((d, voters[i][0]))
        locked_out |= {c for c in contested if c not in flipped and c not in result}
        contested = flipped
        history.append(sorted(contested))
        if not contested or k >= max_extensions or (not callable(profiles) and k + 1 >= last):
            return {
                "rule": rule,
                "funded": funded,
                "extensions": k,
                "contested": history,
                "locked_in": locked_in,
                "locked_out": locked_out,
                "voters": voters,
                "paid": paid,
                "charges": charges,
                "forced": forced,
            }
        snapshot = result
        k += 1


def remove_projects(costs, voters, dead):
    """The instance with the ``dead`` projects taken off every ballot, each voter's
    remaining projects moving up to close the gaps. Returns the reduced costs and
    voters, and the original id of each remaining project."""
    keep = [c for c in range(len(costs)) if c not in dead]
    reduced = []
    for w, ballot in voters:
        if ballot is None:
            reduced.append((w, None))
            continue
        reduced.append(
            (w, [0 if not ballot[c] else 1 + sum(1 for d in keep if 0 < ballot[d] < ballot[c]) for c in keep])
        )
    return [costs[c] for c in keep], reduced, keep


def pin_settled(old, new, settled):
    """``new`` with every settled proposal put back in the tier ``old`` had it in.

    A tier is a group of proposals sharing a rank, counted from the top; unplaced
    proposals stay unplaced. This is the ballot the ``replay`` rule should tally if a
    voter may only move contested proposals during an extension: taking a locked-in
    proposal off the ballot then changes nothing. A voter's first ballot (``old`` is
    ``None``) is taken as it is.
    """
    if old is None or new is None:
        return new

    def tiers(ballot):
        levels = sorted({r for r in ballot if r})
        return [levels.index(r) if r else None for r in ballot]

    was, now = tiers(old), tiers(new)
    tier = [was[c] if c in settled else now[c] for c in range(len(new))]
    ranks, above = [0] * len(new), 0
    for t in sorted({t for t in tier if t is not None}):
        members = [c for c in range(len(new)) if tier[c] == t]
        for c in members:
            ranks[c] = above + 1
        above += len(members)
    return ranks


def extension_lengths(first, minimum):
    """Every extension the schedule can ever grant: each half the last, down to the
    minimum."""
    out = []
    length = first
    while length >= minimum:
        out.append(length)
        length /= 2
    return out
