"""Quiet Ending in steps: PB-EAR exactly as in ``pbear``, paused after every funded
proposal so that voters can change their ballots before the tally goes on.

Nothing else changes. The weights left after each payment, the funded proposals and
the rank level all carry over; a revised ballot only decides what its voter's remaining
weight supports from then on. A holder without a ballot may submit one at a pause, which
puts its weight, until then abstaining, to work. Weights themselves are fixed when the
tally starts: the budget is spent step by step, so it cannot be split again later.

If nobody revises anything, the result is the plain tally of the same ballots.

With ``levels`` the tally pauses once per rank level instead: when nothing more can be
funded at the current level and at least one proposal has been funded since the last
pause. Under the rule that the counted part of a ballot cannot change
(``counted_part_kept``), these are the only pauses at which a revision can still matter.

With ``tiers`` the tally pauses less often still: once for each tier of the ballots, when that
tier has been counted for every voter. A tier is a group of proposals a voter ranks
equally; PB-EAR opens a voter's tier when the rank level reaches the tier's rank, which
is one more than the number of proposals that voter placed above it. So voters' first
tiers all open at level 1, but their second tiers open at different levels, and a tier
is counted for everyone only when the level reaches the highest rank any voter gives it
and nothing more can be funded there. That moment, just before the level moves on, is
the pause. By then the voters with short ballots are already further down: part of
their next tier has been counted too.
"""

from pbear import cumulative_deductions, effective_ranks, validate_ballot
from quiet_ending import _ear, extension_lengths


def counted_part_kept(old, new, level):
    """True if ``new`` leaves alone everything ``old`` had within rank ``level``: no
    proposal enters or leaves the part of the ballot the tally has already counted, and
    none moves inside it. A first ballot (``old`` is ``None``) has no counted part."""
    if old is None:
        return True
    if new is None:
        return False
    before, after = effective_ranks(old), effective_ranks(new)
    return all(a == b for a, b in zip(before, after) if a <= level or b <= level)


def rearranged_below(old, level, order):
    """``old`` with its counted part (ranks up to ``level``) kept and the rest replaced
    by ``order``: a list of tiers, each a list of proposals, placed below the counted
    part in that order. Proposals in neither stay or become unplaced."""
    ranks = effective_ranks(old)
    counted = [c for c in range(len(old)) if ranks[c] <= level and old[c]]
    if any(ranks[c] <= level and not old[c] for c in range(len(old))):
        return list(old)  # the unplaced tier is already counted: nothing is left to move
    new = [old[c] if c in counted else 0 for c in range(len(old))]
    above = len(counted)
    for tier in order:
        tier = [c for c in tier if c not in counted]
        for c in tier:
            new[c] = above + 1
        above += len(tier)
    return new


def tier_levels(ballots, tiers):
    """For each of the first ``tiers`` tiers, the rank level at which the last voter's
    tier opens (``None`` if no ballot has that many tiers)."""
    out = []
    for t in range(tiers):
        ranks = [sorted({r for r in b if r}) for b in ballots if b is not None]
        ranks = [r[t] for r in ranks if len(r) > t]
        out.append(max(ranks) if ranks else None)
    return out


def run_in_steps(costs, voters, abstaining=0, revise=None, tiers=None, levels=False):
    """Tally ``voters`` (``(weight, ballot)`` pairs), calling ``revise`` after each
    funded proposal while something can still be funded, or, if ``tiers`` is given,
    once per tier instead (see the module text), or, with ``levels``, each time the
    rank level is about to move on after funding something. ``pauses`` in the result
    then lists the level, the number of funded proposals and the amount spent at each
    pause.

    ``revise(state)`` gets a dict with ``funded``, ``weights`` (what each voter has
    left), ``level``, ``ballots`` and ``paid``, and returns the ballots to go on with
    (or ``None`` to keep them). Returns the final state, with ``steps`` added: one
    record per funded proposal, ``(proposal, level, {voter: paid})``.
    """
    m = len(costs)
    weights = [w for w, _ in voters]
    ballots = [b for _, b in voters]
    budget = sum(weights) + abstaining

    def ranked(all_ballots):
        out = []
        for ballot in all_ballots:
            if ballot is None:
                out.append(None)
            else:
                validate_ballot(ballot, m)
                out.append(effective_ranks(ballot))
        return out

    ranks = ranked(ballots)
    funded, is_funded, spent, level, steps = [], [False] * m, 0, 1, []
    pauses, next_tier = [], 0

    def state():
        return {
            "funded": list(funded),
            "weights": list(weights),
            "level": level,
            "ballots": list(ballots),
            "paid": {c: dict(shares) for c, _, shares in steps},
            "steps": list(steps),
            "budget": budget,
            "spent": spent,
            "pauses": list(pauses),
        }

    def exhausted():
        return all(is_funded[c] or spent + costs[c] > budget for c in range(m))

    while not exhausted():
        open_projects = [c for c in range(m) if not is_funded[c]]
        support = [0] * m
        for i, r in enumerate(ranks):
            w = weights[i]
            if r is None or w == 0:
                continue
            for c in open_projects:
                if r[c] <= level:
                    support[c] += w
        best = None
        for c in open_projects:
            if support[c] < costs[c]:
                continue
            if best is None or support[c] > support[best] or (
                support[c] == support[best] and costs[c] < costs[best]
            ):
                best = c
        if best is None:
            if level >= m:
                break
            if levels and revise is not None and len(funded) > (pauses[-1]["funded"] if pauses else 0):
                pauses.append({"level": level, "funded": len(funded), "spent": spent})
                revised = revise(state())
                if revised is not None:
                    ballots = list(revised)
                    ranks = ranked(ballots)
            elif tiers is not None and revise is not None:
                # A later tier is not done before an earlier one: a short ballot's third
                # tier can rank above a long ballot's second.
                bounds, highest = [], 0
                for bound in tier_levels(ballots, tiers):
                    highest = highest if bound is None else max(highest, bound)
                    bounds.append(None if bound is None else highest)
                due = [t for t in range(next_tier, tiers) if bounds[t] is not None and bounds[t] <= level]
                if due:
                    next_tier = due[-1] + 1
                    pauses.append({"level": level, "funded": len(funded), "spent": spent})
                    revised = revise(state())
                    if revised is not None:
                        ballots = list(revised)
                        ranks = ranked(ballots)
            level += 1
            continue
        supporters = [i for i, r in enumerate(ranks) if r is not None and weights[i] and r[best] <= level]
        deductions = cumulative_deductions([weights[i] for i in supporters], costs[best])
        for i, d in zip(supporters, deductions):
            weights[i] -= d
        is_funded[best] = True
        funded.append(best)
        spent += costs[best]
        steps.append((best, level, dict(zip(supporters, deductions))))
        if revise is not None and tiers is None and not levels and not exhausted():
            revised = revise(state())
            if revised is not None:
                ballots = list(revised)
                ranks = ranked(ballots)
    return state()


def run_daily(
    costs,
    voters,
    abstaining,
    ballots_for_day,
    tiers=3,
    max_days=6,
    accept="prefix",
    hours=None,
    baseline=None,
    newcomers_wait=False,
    payment_tolerance=None,
    lock_supporters=False,
    asks_for_day=None,
):
    """Quiet Ending by tiers with a daily tally: a proposal is accepted only when two
    tallies a day apart both fund it.

    The round goes through one stage per tier and a last one for the unplaced
    proposals. In each stage the tally is PB-EAR on the day's ballots, starting from
    the accepted proposals and the weight their payers have left, and stopping at the
    rank level where the stage's tier has been counted for everyone (``tier_levels``).
    Day 0 is the day before the deadline and only sets the first baseline. On each
    later day the stage's tally is compared with the previous one:

    ``accept="tier"``    nothing is accepted until the stage ends; then the day's whole
                         tally is. Every accepted step is then a PB-EAR step on the
                         ballots of the day its tier closed;
    ``accept="both"``    every proposal funded in both tallies is accepted, with the
                         payments of today's tally;
    ``accept="prefix"``  today's tally is accepted in its own order up to the first
                         proposal that yesterday's tally did not fund, so what is
                         accepted is always the start of a real PB-EAR run.

    A stage ends on the day its tally funds exactly what the previous one did; the next
    stage's baseline is taken at once, on the same ballots. After ``max_days`` days in
    a stage, the day's whole tally is accepted and the stage ends.

    ``hours`` replaces the day limit with a halving schedule ``(first, minimum,
    restart)``: the tallies are ``first`` hours apart, then half that, and so on down to
    ``minimum``; when no interval is left, the tally is accepted whole and the stage
    ends. With ``restart`` every stage starts again from ``first``; without it the
    schedule runs once for the whole round, and stages still open when it runs out are
    closed at that moment. Each day record then has the ``hours`` since the previous
    tally, and ``state`` has the same number as ``window``.

    A holder's weight is a fixed amount for the whole round; a holder without a ballot
    has its weight in the budget but supports nothing, and may submit a ballot on a
    later day. With ``newcomers_wait`` such a ballot is left out of the tally of the
    day it appears and counted from the next one, so that two tallies being compared
    always differ by one day of changes among the same voters or by one day's
    newcomers, never both. ``baseline`` gives the proposals funded by the day-0 tally
    when that tally was taken some other way (with other weights, say); day 0 is then
    not asked for.

    Payments always come from the tally being accepted, never from the earlier one it
    is compared with: the earlier tally only says which proposals were funded. Two
    tallies can therefore fund the same proposals while different voters pay. Each day
    record has ``shifted``: for the proposals both tallies of the stage fund, how much
    of their cost changed hands, comparing each voter's share of each proposal's cost
    (so a lower cost shared in the same proportions shifts nothing). With
    ``payment_tolerance`` a stage also stays open while more than that amount has
    shifted.

    ``asks_for_day(day)`` gives the proposals' costs on a day, for rounds in which
    donations lower them; ``costs`` is used otherwise. A tally uses the costs of its
    day, and an accepted proposal is paid the cost of the day it is accepted.

    With ``lock_supporters`` every tally is a commitment for the next one: a voter who
    would pay for a proposal in the previous tally of the stage may not give that
    proposal a worse rank. A revised ballot that does is refused whole and the voter's
    previous ballot stands; ``refused`` in the day record counts them. ``state`` has the
    previous tally as ``provisional`` and each voter's locked proposals as ``locks``.

    ``ballots_for_day(day, state)`` returns the ballots for that day; ``state`` (``None``
    on day 0) has ``funded``, ``weights``, ``stage``, ``locked_level`` (the level up to
    which earlier stages counted), ``stage_level`` (the level the current stage counts
    to), ``contested``, ``paid`` and ``ballots``. Which revisions are
    allowed is up to the caller. Returns the final state with ``days``, one record per
    day after day 0, and ``forced``, the stages closed by the day limit.
    """
    m = len(costs)
    weights = [w for w, _ in voters]
    budget = sum(weights) + abstaining
    funded, paid, days, forced = [], {}, [], []

    def bound(ballots, stage):
        if stage >= tiers:
            return m
        highest = 1  # level 1 is always counted, even if no ballot places anything
        for level in tier_levels(ballots, tiers)[: stage + 1]:
            highest = highest if level is None else max(highest, level)
        return highest

    def moved(shares, earlier, earlier_costs):
        """Cost that changed hands between two tallies, over the proposals both fund:
        each voter's earlier payment is scaled to today's cost before comparing."""
        total = 0
        for c, now in shares.items():
            if c not in earlier:
                continue
            was = {i: d * costs[c] // earlier_costs[c] for i, d in earlier[c].items()}
            total += sum(abs(now.get(i, 0) - was.get(i, 0)) for i in set(now) | set(was)) // 2
        return total

    def provisional(ballots, stage):
        ranks = []
        for ballot in ballots:
            if ballot is None:
                ranks.append(None)
            else:
                validate_ballot(ballot, m)
                ranks.append(effective_ranks(ballot))
        spent = sum(sum(shares.values()) for shares in paid.values())
        candidates = [c for c in range(m) if c not in paid]
        order, shares, _ = _ear(costs, list(weights), ranks, budget, spent, candidates, max_level=bound(ballots, stage))
        return order, shares

    lengths = extension_lengths(hours[0], hours[1]) if hours else None

    def state(ballots, stage, contested, window=None):
        return {
            "window": window,
            "provisional": list(provisional_order),
            "locks": {i: set(cs) for i, cs in locks.items()},
            "funded": list(funded),
            "weights": list(weights),
            "stage": stage,
            "locked_level": bound(ballots, stage - 1) if stage else 0,
            "stage_level": bound(ballots, min(stage, tiers)),
            "contested": set(contested),
            "ballots": list(ballots),
            "paid": {c: dict(shares) for c, shares in paid.items()},
            "budget": budget,
            "spent": sum(sum(shares.values()) for shares in paid.values()),
        }

    def supporters(order, shares):
        held = {}
        for c in order:
            for i in shares[c]:
                held.setdefault(i, set()).add(c)
        return held

    stage, stage_days, day = 0, 0, 0
    costs = list(asks_for_day(0)) if asks_for_day else list(costs)
    provisional_order, locks, previous_payments, previous_costs = [], {}, None, costs
    if baseline is None:
        ballots = list(ballots_for_day(0, None))
        provisional_order, opening_shares = provisional(ballots, stage)
        previous = set(provisional_order)
        previous_payments = opening_shares
        locks = supporters(provisional_order, opening_shares)
    else:
        ballots = [None] * len(voters)
        previous = set(baseline)
    contested = set(previous)
    roll = {i for i, b in enumerate(ballots) if b is not None}
    while stage <= tiers:
        day += 1
        window, last = None, False
        if hours:
            index = stage_days if hours[2] else day - 1
            window = lengths[index] if index < len(lengths) else 0
            last = index + 1 >= len(lengths)
        before = ballots
        if asks_for_day:
            costs = list(asks_for_day(day))
        ballots = list(ballots_for_day(day, state(ballots, stage, contested, window)))
        refused = 0
        if lock_supporters:
            for i, held in locks.items():
                old, new = before[i], ballots[i]
                if old is None or new == old:
                    continue
                was, now = effective_ranks(old), None if new is None else effective_ranks(new)
                if now is None or any(now[c] > was[c] for c in held):
                    ballots[i] = old
                    refused += 1
        counted = [b if i in roll else None for i, b in enumerate(ballots)] if newcomers_wait else ballots
        newcomers = sum(1 for i, b in enumerate(ballots) if b is not None and i not in roll)
        roll = {i for i, b in enumerate(ballots) if b is not None}
        order, shares = provisional(counted, stage)
        stage_days += 1
        shifted = None
        if previous_payments is not None:
            shifted = moved(shares, previous_payments, previous_costs)
        steady = payment_tolerance is None or shifted is None or shifted <= payment_tolerance
        closing = last if hours else stage_days > max_days
        if closing and (set(order) != previous or not steady):
            take = list(order)
            forced.append(stage)
        elif closing:
            take = list(order)
        elif accept == "tier":
            take = list(order) if set(order) == previous and steady and not (newcomers_wait and newcomers) else []
        elif accept == "both":
            take = [c for c in order if c in previous]
        elif accept == "prefix":
            take = []
            for c in order:
                if c not in previous:
                    break
                take.append(c)
        else:
            raise ValueError(accept)
        for c in take:
            for i, d in shares[c].items():
                weights[i] -= d
            paid[c] = shares[c]
            funded.append(c)
        # A stage cannot end on a day when new ballots are still waiting to be counted.
        quiet = (set(order) == previous and steady and not (newcomers_wait and newcomers)) or closing
        contested = (previous ^ set(order)) | (set(order) - set(take))
        days.append(
            {
                "day": day,
                "stage": stage,
                "tally": len(order),
                "accepted": len(take),
                "quiet": quiet,
                "hours": window,
                "closed_by_schedule": closing,
                "newcomers": newcomers,
                "shifted": shifted,
                "refused": refused,
            }
        )
        if quiet:
            stage, stage_days = stage + 1, 0
            if stage <= tiers:
                opening, opening_shares = provisional(counted, stage)
                previous = set(opening)
                previous_payments, previous_costs = opening_shares, costs
                provisional_order, locks = opening, supporters(opening, opening_shares)
                contested = set(previous)
        else:
            previous = set(order) - set(take)
            previous_payments = {c: p for c, p in shares.items() if c not in take}
            previous_costs = costs
            provisional_order = [c for c in order if c not in take]
            locks = supporters(provisional_order, shares)
            if accept == "tier":
                previous = set(order)
    result = state(ballots, stage, set())
    result["days"], result["forced"] = days, forced
    return result


def tier_of(ballot, proposal):
    """Which tier of ``ballot`` holds ``proposal``: 0 for the first; unplaced proposals
    come after every tier."""
    if ballot is None or not ballot[proposal]:
        return len(ballot or ()) + 1
    return sorted({r for r in ballot if r}).index(ballot[proposal])


def run_on_time(
    costs,
    voters,
    abstaining,
    ballots_for_day,
    tiers=3,
    hours=(12, 1),
    quiet_window=24,
    payment_tolerance=None,
    lock_supporters=False,
    asks_for_day=None,
):
    """Quiet Ending by tiers that extends only when a tier changed.

    Tally 0 is taken when the quiet window opens and tally 1 at the deadline. Every
    tally covers all the tiers still open, one stage per tier and a last one for the
    unplaced proposals, each stage starting from what the stages before it would fund
    (``run_daily`` describes a stage). A tally is compared with the previous one stage
    by stage, in order. A stage is quiet if both fund the same proposals and, with
    ``payment_tolerance``, no more than that amount of their cost changed hands. A
    quiet stage is accepted whole, with the payments of the later tally, and the
    comparison goes on to the next stage. When the last tier is accepted so is the
    stage of the unplaced proposals, which nobody could change any more, and the round
    ends. If every tier is quiet at the deadline, that is the deadline.

    The first stage that is not quiet stops the comparison. Nothing from it or from
    the stages below is accepted, and the next tally is taken after an extension:
    ``hours`` is ``(first, minimum)``, the first extension a stage gets and the
    shortest one worth running, each extension being half the one before. Every stage
    starts its own count. A stage that is still not quiet after its last extension is
    accepted as it stands, and the comparison goes on below it.

    With ``lock_supporters`` a voter who would pay for a proposal in the previous
    tally may not move it to a lower tier or take it off: ``"first"`` (or ``True``)
    binds the supporters of the first open stage, ``"all"`` those of every open stage.
    A revised ballot that breaks this is refused whole.

    ``ballots_for_day(day, state)`` and the result are as in ``run_daily``, with
    ``stage`` the first stage still open. Each day record has the stage the comparison
    started at, ``confirmed`` (the stages accepted that day), ``hours`` since the
    previous tally, and ``shifted`` for the stage where the comparison stopped.
    """
    m = len(costs)
    weights = [w for w, _ in voters]
    budget = sum(weights) + abstaining
    funded, paid, days, forced = [], {}, [], []
    lengths = extension_lengths(*hours)
    scope = "first" if lock_supporters is True else lock_supporters

    def bound(ballots, stage):
        if stage >= tiers:
            return m
        highest = 1
        for level in tier_levels(ballots, tiers)[: stage + 1]:
            highest = highest if level is None else max(highest, level)
        return highest

    def tally_open(ballots, first):
        """The open stages' tallies, ``(order, shares)`` from stage ``first`` down."""
        ranks = []
        for ballot in ballots:
            if ballot is None:
                ranks.append(None)
            else:
                validate_ballot(ballot, m)
                ranks.append(effective_ranks(ballot))
        held, done = list(weights), set(paid)
        spent = sum(sum(shares.values()) for shares in paid.values())
        out = []
        for stage in range(first, tiers + 1):
            candidates = [c for c in range(m) if c not in done]
            order, shares, _ = _ear(costs, held, ranks, budget, spent, candidates, max_level=bound(ballots, stage))
            done |= set(order)
            spent += sum(sum(shares[c].values()) for c in order)
            out.append((order, shares))
        return out

    def moved(shares, earlier, earlier_costs):
        total = 0
        for c, now in shares.items():
            if c not in earlier:
                continue
            was = {i: d * costs[c] // earlier_costs[c] for i, d in earlier[c].items()}
            total += sum(abs(now.get(i, 0) - was.get(i, 0)) for i in set(now) | set(was)) // 2
        return total

    def supporters(tallies):
        held = {}
        for order, shares in tallies[:1] if scope == "first" else tallies:
            for c in order:
                for i in shares[c]:
                    held.setdefault(i, set()).add(c)
        return held

    def state(ballots, first, contested, window=None):
        return {
            "window": window,
            "provisional": list(previous[0][0]),
            "provisional_all": [c for order, _ in previous for c in order],
            "open_level": bound(ballots, tiers - 1),
            "locks": {i: set(cs) for i, cs in locks.items()},
            "funded": list(funded),
            "weights": list(weights),
            "stage": first,
            "locked_level": bound(ballots, first - 1) if first else 0,
            "stage_level": bound(ballots, min(first, tiers)),
            "contested": set(contested),
            "ballots": list(ballots),
            "paid": {c: dict(shares) for c, shares in paid.items()},
            "budget": budget,
            "spent": sum(sum(shares.values()) for shares in paid.values()),
        }

    costs = list(asks_for_day(0)) if asks_for_day else list(costs)
    ballots = list(ballots_for_day(0, None))
    previous, previous_costs = tally_open(ballots, 0), costs
    locks = supporters(previous) if scope else {}
    contested = set(previous[0][0])
    first, extensions, day, window = 0, 0, 0, quiet_window
    while first <= tiers:
        day += 1
        before = ballots
        if asks_for_day:
            costs = list(asks_for_day(day))
        ballots = list(ballots_for_day(day, state(ballots, first, contested, window)))
        refused = 0
        for i, held in locks.items():
            old, new = before[i], ballots[i]
            if old is None or new == old:
                continue
            if new is None or any(tier_of(new, c) > tier_of(old, c) for c in held):
                ballots[i] = old
                refused += 1
        current = tally_open(ballots, first)
        started, stage, confirmed, accepted, cut, shifted = first, first, [], 0, False, None
        while stage <= tiers:
            order, shares = current[stage - started]
            if stage < tiers:
                earlier_order, earlier_shares = previous[stage - started]
                shifted = moved(shares, earlier_shares, previous_costs)
                steady = payment_tolerance is None or shifted <= payment_tolerance
                if set(order) != set(earlier_order) or not steady:
                    if stage != first or extensions < len(lengths):
                        break
                    forced.append(stage)
                    cut = True
            for c in order:
                for i, d in shares[c].items():
                    weights[i] -= d
                paid[c] = shares[c]
                funded.append(c)
            confirmed.append(stage)
            accepted += len(order)
            stage += 1
        days.append(
            {
                "day": day,
                "stage": started,
                "confirmed": confirmed,
                "tally": len(current[0][0]),
                "accepted": accepted,
                "quiet": stage > tiers,
                "hours": window,
                "closed_by_schedule": cut,
                "shifted": shifted,
                "refused": refused,
            }
        )
        if stage > tiers:
            first = stage
            break
        if stage != first:
            first, extensions = stage, 0
        window = lengths[extensions]
        extensions += 1
        open_now = current[stage - started :]
        contested = set(open_now[0][0])
        for (order, _), (earlier_order, _) in zip(open_now, previous[stage - started :]):
            contested |= set(order) ^ set(earlier_order)
        previous, previous_costs = open_now, costs
        locks = supporters(previous) if scope else {}
    previous = [([], {})]
    result = state(ballots, first, set())
    result["days"], result["forced"] = days, forced
    return result
