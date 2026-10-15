"""Simulated Quiet Ending rounds on a real set of proposals: the 49 initiatives of
TheDAO Security Fund (`thedao_initiatives.json`), each asking 25% less than on its page
and at most $200,000, for a $1,000,000 pool and 200 badge holders. Between them they
ask for about 4.4 times the pool.

The proposals, their costs and their categories are real; the voters are invented.
Holders belong to interest groups that match the ten categories; a holder likes a
proposal for its category, its general quality and personal taste, and submits an S/A/B
tier ballot with ties, leaving most proposals unplaced. The pool is split equally among
the holders who have submitted a ballot, so every new ballot shrinks the others' shares.

Most holders vote before the quiet window. One group mostly waits and arrives during
the window, which is what moves the result at the deadline. During each extension a few
more holders arrive and some of those present move the contested proposal they like
best into their S tier.

`World(seed, proposals=200)` gives the earlier, fully invented world instead: that many
proposals in six categories, asking about seven times the pool.

Run it as a script to print the comparisons:

    python3 reference/quiet_ending_sim.py [rounds]
"""

import json
import math
import os
import random
import sys

from quiet_ending import RULES, _ear, extension_lengths, remove_projects, run_round, tally
from pbear import effective_ranks
from quiet_ending_steps import counted_part_kept, rearranged_below, run_daily, run_in_steps, run_on_time

POOL = 1_000_000 * 10**6  # one million dollars in 6-decimal token units
with open(os.path.join(os.path.dirname(__file__), "thedao_initiatives.json")) as source:
    INITIATIVES = json.load(source)["initiatives"]
CATEGORIES = sorted({initiative["category"] for initiative in INITIATIVES})
MAX_EXTENSIONS = len(extension_lengths(48, 1))


class World:
    def __init__(self, seed, holders=200, proposals=None, dodging_group=None, respond=0.4):
        rng = random.Random(seed)
        self.seed = seed
        self.dodging_group = dodging_group
        self.respond = respond
        if proposals is None:
            self.titles = [initiative["title"] for initiative in INITIATIVES]
            self.groups = len(CATEGORIES)
            self.category = [CATEGORIES.index(initiative["category"]) for initiative in INITIATIVES]
            self.costs = [initiative["cost"] * 10**6 for initiative in INITIATIVES]
            proposals = len(INITIATIVES)
        else:
            self.groups = 6
            self.category = None
        self.n, self.m = holders, proposals
        self.favourites = max(5, round(0.15 * proposals))  # how many proposals a holder cares about
        sizes = [rng.uniform(1, 4) for _ in range(self.groups)]
        self.group = rng.choices(range(self.groups), sizes, k=holders)
        if self.category is None:
            self.category = [rng.randrange(self.groups) for _ in range(proposals)]
        quality = [rng.gauss(0, 1) for _ in range(proposals)]
        if not hasattr(self, "costs"):
            asks = [min(200_000, max(3_000, math.exp(rng.gauss(math.log(30_000), 0.7)))) for _ in range(proposals)]
            self.costs = [int(round(a, -2)) * 10**6 for a in asks]
        self.utility = [
            [1.5 * (self.category[c] == self.group[i]) + 0.8 * quality[c] + rng.gauss(0, 1) for c in range(proposals)]
            for i in range(holders)
        ]
        self.tier_sizes = [(rng.randint(2, 5), rng.randint(3, 8), rng.randint(4, 10)) for _ in range(holders)]
        late = sorted(range(self.groups), key=self.group.count)[-2]  # the second largest group
        self.late_group = late
        self.arrival = []
        for i in range(holders):
            roll = rng.random()
            if self.group[i] == late:
                stage = 0 if roll < 0.35 else 1 if roll < 0.9 else 2
            else:
                stage = 0 if roll < 0.75 else 1 if roll < 0.87 else 2 if roll < 0.91 else 3 if roll < 0.93 else None
            self.arrival.append(stage)

    def ballot(self, i, promoted=(), dropped=()):
        """Holder i's tier ballot as competition ranks: `promoted` proposals join the S
        tier, `dropped` ones are left unplaced."""
        order = sorted((c for c in range(self.m) if c not in dropped), key=lambda c: -self.utility[i][c])
        s, a, b = self.tier_sizes[i]
        tiers = [order[:s], order[s : s + a], order[s + a : s + a + b]]
        tiers = [[c for c in tier if c not in promoted] for tier in tiers]
        tiers[0] = sorted(set(tiers[0]) | set(promoted))
        ranks, above = [0] * self.m, 0
        for tier in tiers:
            for c in tier:
                ranks[c] = above + 1
            above += len(tier)
        return ranks

    def profiles(self, rule):
        """The checkpoint function `run_round` asks for. Extension ballots depend on
        what is contested, so each rule gets its own history after the deadline."""
        promoted = [set() for _ in range(self.n)]
        dropped = [set() for _ in range(self.n)]
        state = {"voters": None}

        def profile(k, contested, funded):
            rng = random.Random(f"{self.seed}/{rule}/{k}")
            present = [a is not None and a <= k for a in self.arrival]
            if k >= 2:
                locked_in = [c for c in funded if c not in contested]
                for i in range(self.n):
                    if not present[i]:
                        continue
                    if self.dodging_group == self.group[i]:
                        dropped[i] = set(locked_in)
                    if contested and rng.random() < self.respond:
                        favourite = max(contested, key=lambda c: self.utility[i][c])
                        if favourite in sorted(range(self.m), key=lambda c: -self.utility[i][c])[: self.favourites]:
                            promoted[i].add(favourite)
            share = POOL // max(1, sum(present))
            voters = [
                (share, self.ballot(i, promoted[i], dropped[i])) if present[i] else (0, None) for i in range(self.n)
            ]
            state["voters"] = voters
            return voters, POOL - share * sum(present)

        return profile

    def play(self, rule):
        return run_round(self.costs, self.profiles(rule), rule=rule, max_extensions=MAX_EXTENSIONS)

    def play_in_steps(self, active=(), tiers=None, watch=False, revision="promote"):
        """Quiet Ending in steps on the deadline ballots, shares fixed at the deadline.
        At every pause each `active` holder who has weight left revises its ballot:

        "promote"  moves the proposal it likes best among those that can still be
                   funded into its S tier, if it is one of its favourites;
        "drop"     takes the funded proposals off its ballot, so the rest move up;
        "below"    moves that favourite to the top of the part of its ballot the tally
                   has not counted yet, and touches nothing above.
        """
        present = [a is not None and a <= 1 for a in self.arrival]
        share = POOL // sum(present)
        voters = [(share, self.ballot(i)) if present[i] else (0, None) for i in range(self.n)]
        active = [i for i in active if present[i]]
        liked = {i: set(sorted(range(self.m), key=lambda c: -self.utility[i][c])[: self.favourites]) for i in active}
        promoted = {i: set() for i in active}

        def revise(state):
            room = state["budget"] - state["spent"]
            open_proposals = [c for c in range(self.m) if c not in state["funded"] and self.costs[c] <= room]
            ballots = state["ballots"]
            for i in active:
                if not state["weights"][i]:
                    continue
                if revision == "drop":
                    ballots[i] = self.ballot(i, dropped=state["funded"])
                    continue
                favourite = max(open_proposals, key=lambda c: self.utility[i][c])
                if favourite not in liked[i] or favourite in promoted[i]:
                    continue
                promoted[i].add(favourite)
                if revision == "promote":
                    ballots[i] = self.ballot(i, promoted[i])
                else:
                    old = ballots[i]
                    later = sorted({r for r in old if r > state["level"]})
                    order = [[favourite]] + [[c for c in range(self.m) if old[c] == r and c != favourite] for r in later]
                    ballots[i] = rearranged_below(old, state["level"], order)
            return ballots

        if watch and not active:
            revise = lambda state: None  # pause without changing anything
        return run_in_steps(
            self.costs, voters, POOL - share * sum(present), revise if active or watch else None, tiers
        )

    def play_by_level(self, active=(), campaign=None, tiers=None):
        """Quiet Ending with a pause at each rank level that funded something, under
        the strict rule: a revision may only rearrange the part of a ballot the tally
        has not counted yet.

        At each pause every `active` holder moves the proposal it likes best among
        those that can still be funded to the top of its uncounted part, if it is one
        of its favourites. `campaign` is `(day, proposal)`: at that pause (days
        count from 1) every holder who has the proposal among its favourites
        does the same with it. The result has a `days` list describing each pause.
        With `tiers` the pauses come once per tier instead of once per level.
        """
        present = [a is not None and a <= 1 for a in self.arrival]
        voting = [i for i in range(self.n) if present[i]]
        share = POOL // len(voting)
        voters = [(share, self.ballot(i)) if present[i] else (0, None) for i in range(self.n)]
        liked = {i: set(sorted(range(self.m), key=lambda c: -self.utility[i][c])[: self.favourites]) for i in voting}
        active = [i for i in active if present[i]]
        asked = {i: set() for i in voting}
        days = []

        def move_up(ballots, i, proposal, level):
            old = ballots[i]
            if effective_ranks(old)[proposal] <= level:
                return False  # already counted for this holder
            later = sorted({r for r in old if r > level})
            order = [[proposal]] + [[c for c in range(self.m) if old[c] == r and c != proposal] for r in later]
            new = rearranged_below(old, level, order)
            assert counted_part_kept(old, new, level)
            ballots[i] = new
            return new != old

        def revise(state):
            level, ballots = state["level"], state["ballots"]
            room = state["budget"] - state["spent"]
            open_proposals = [c for c in range(self.m) if c not in state["funded"] and self.costs[c] <= room]
            revised = 0
            if campaign and campaign[0] == len(days) + 1:
                revised += sum(move_up(ballots, i, campaign[1], level) for i in voting if campaign[1] in liked[i])
            for i in active:
                if not state["weights"][i] or not open_proposals:
                    continue
                favourite = max(open_proposals, key=lambda c: self.utility[i][c])
                if favourite in liked[i] and favourite not in asked[i]:
                    asked[i].add(favourite)
                    revised += move_up(ballots, i, favourite, level)
            locked = [sum(1 for r in effective_ranks(ballots[i]) if r <= level) for i in voting]
            days.append(
                {
                    "level": level,
                    "funded": len(state["funded"]) - (days[-1]["total"] if days else 0),
                    "total": len(state["funded"]),
                    "spent": state["spent"] / POOL,
                    "fully_locked": sum(n == self.m for n in locked) / len(voting),
                    "out_of_weight": sum(not state["weights"][i] for i in voting) / len(voting),
                    "revised": revised,
                    "open": len(open_proposals),
                }
            )
            return ballots

        result = run_in_steps(self.costs, voters, POOL - share * len(voting), revise, tiers, levels=tiers is None)
        result["days"] = days
        result["voters"] = [(share if present[i] else 0, b) for i, b in enumerate(result["ballots"])]
        return result

    def play_daily(
        self,
        accept="prefix",
        respond=0.4,
        payers_locked=True,
        max_days=6,
        hours=None,
        newcomers="closed",
        payment_tolerance=None,
        lock_supporters=False,
        attack=None,
        on_time=None,
        calm=False,
    ):
        """Quiet Ending by tiers with a daily tally (`run_daily`). Day 0 is the ballots
        when the quiet window opens and day 1 the deadline, when the late group has
        arrived. From day 2, each holder with weight left reacts with probability
        `respond` by adding the contested proposal it likes best to the first tier of
        its ballot that is still open, if it is one of its favourites.

        Tiers counted in earlier stages are locked for everyone and accepted proposals
        stay where they are. With `payers_locked`, a holder who has paid for an accepted
        proposal can no longer change the tier of the current stage either.

        With `hours` (see `run_daily`) the tallies follow a halving schedule, and a
        shorter window reaches fewer holders: the chance of reacting falls with the
        square root of the window's length, from `respond` for 24 hours.

        `newcomers` says what happens to holders who submit their first ballot late:

        "closed"   Nobody joins after the deadline. The pool is split among the ballots
                   in at the deadline. The day-0 tally is taken with those same shares,
                   the holders still to arrive counting as money nobody directs.
        "percent"  As "closed", but the day-0 tally splits the pool among the ballots in
                   at that moment, as the live result of that day would have shown.
        "units"    Every badge holder has the same fixed share of the pool whether or
                   not it votes, and may submit a first ballot on any day; the shares
                   of those who never do are not spent.
        "wait"     As "units", but a first ballot is counted from the tally after the
                   one it arrives at.

        `attack` makes the largest group (its members who voted before the window)
        act together at every tally from the deadline on, instead of reacting:

        "step out"   they take off their ballots every provisionally funded proposal
                     that would still pass without them;
        "flip flop"  they pick the proposal closest to passing that they can push over
                     the line, add it at one tally and take it off at the next;
        "fresh"      they push a different such proposal over the line at every tally
                     and never take one off.

        With `on_time` there is also "step out below": as "step out", but from the
        provisionally funded proposals of every open tier, not only the first.

        The result lists them as `attackers`.

        `on_time` plays the round with `run_on_time` instead: it is the `(first,
        minimum)` hours of a tier's extensions, and the round only extends when a tier
        changed. `accept`, `max_days` and `hours` are then ignored and the roll is
        closed at the deadline. With `calm` the holders who would arrive during the
        quiet window vote before it, so nothing moves on the last day.
        """
        late = newcomers in ("units", "wait")
        joins = [a if a is not None and (late or a <= 1) else None for a in self.arrival]  # the day each ballot arrives
        if calm:
            joins = [0 if a == 1 else a for a in joins]
        voting = [i for i in range(self.n) if joins[i] is not None]
        share = POOL // (self.n if late else len(voting))
        weights = [share if late or joins[i] is not None else 0 for i in range(self.n)]
        voters = [(w, None) for w in weights]
        liked = {i: set(sorted(range(self.m), key=lambda c: -self.utility[i][c])[: self.favourites]) for i in voting}
        rng = random.Random(f"{self.seed}/daily/{accept}")
        baseline = None
        if newcomers == "percent":
            early = [i for i in voting if joins[i] == 0]
            first = POOL // len(early)
            window = [(first, self.ballot(i)) if joins[i] == 0 else (0, None) for i in range(self.n)]
            ranks = [None if b is None else effective_ranks(b) for _, b in window]
            baseline = set(_ear(self.costs, [w for w, _ in window], ranks, POOL, 0, range(self.m), max_level=1)[0])

        def join_open_tier(old, lock, proposal):
            if effective_ranks(old)[proposal] <= lock:
                return old
            order = [[c for c in range(self.m) if old[c] == r and c != proposal] for r in sorted({r for r in old if r > lock})]
            order = [order[0] + [proposal]] + order[1:] if order else [[proposal]]
            new = rearranged_below(old, lock, order)
            assert counted_part_kept(old, new, lock)
            return new

        attackers = []
        if attack:
            largest = max(range(self.groups), key=self.group.count)
            attackers = [i for i in voting if self.group[i] == largest and joins[i] == 0]
        plan = {"stage": None, "target": None, "added": False, "used": set()}

        def tiers_of(ballot):
            return [[c for c in range(self.m) if ballot[c] == r] for r in sorted({r for r in ballot if r})]

        def dropped(old, lock, proposal):
            if effective_ranks(old)[proposal] <= lock:
                return old
            order = [[c for c in tier if c != proposal] for tier in tiers_of(old)]
            return rearranged_below(old, lock, order)

        def act(day, state, ballots):
            """The attackers' move for this tally, on top of everyone else's ballots."""
            level, lock, held = state["stage_level"], state["locked_level"], state["weights"]
            earlier = state["ballots"]

            def backing(c, among):
                return sum(held[i] for i in among if earlier[i] is not None and effective_ranks(earlier[i])[c] <= level)

            def pushable():
                room = state["budget"] - state["spent"]
                best = None
                for c in range(self.m):
                    if c in state["funded"] or c in state["provisional"] or c in plan["used"] or self.costs[c] > room:
                        continue
                    short = self.costs[c] - backing(c, voting)
                    spare = sum(held[i] for i in attackers) - backing(c, attackers)
                    if 0 < short <= spare and (best is None or short < best[0]):
                        best = (short, c)
                return None if best is None else best[1]

            if attack == "step out below":
                level = state["open_level"]
            if attack in ("step out", "step out below"):
                for c in state["provisional_all" if attack == "step out below" else "provisional"]:
                    theirs = backing(c, attackers)
                    if theirs and backing(c, voting) - theirs >= self.costs[c]:
                        for i in attackers:
                            ballots[i] = dropped(ballots[i], lock, c)
                return
            if plan["stage"] != state["stage"]:
                plan.update(stage=state["stage"], target=None, added=False)
            if attack == "fresh" or plan["target"] is None:
                plan["target"], plan["added"] = pushable(), False
                if plan["target"] is None:
                    return
                plan["used"].add(plan["target"])
            for i in attackers:
                if plan["added"]:
                    ballots[i] = dropped(ballots[i], lock, plan["target"])
                else:
                    ballots[i] = join_open_tier(ballots[i], lock, plan["target"])
            plan["added"] = not plan["added"]

        def ballots_for_day(day, state):
            if day <= 1:
                ballots = [self.ballot(i) if joins[i] is not None and joins[i] <= day else None for i in range(self.n)]
                if day == 1 and attackers:
                    act(day, state, ballots)
                return ballots
            ballots = state["ballots"]
            contested = sorted(state["contested"])
            payers = {i for shares in state["paid"].values() for i, d in shares.items() if d}
            chance = respond if state["window"] is None else respond * math.sqrt(state["window"] / 24)
            for i in voting:
                if ballots[i] is None:
                    if joins[i] <= day:
                        ballots[i] = self.ballot(i)
                    continue
                if i in attackers:
                    continue
                if not contested or not state["weights"][i] or rng.random() >= chance:
                    continue
                favourite = max(contested, key=lambda c: self.utility[i][c])
                if favourite not in liked[i] or favourite in state["funded"]:
                    continue
                lock = state["stage_level"] if payers_locked and i in payers else state["locked_level"]
                ballots[i] = join_open_tier(ballots[i], lock, favourite)
            if attackers:
                act(day, state, ballots)
            return ballots

        if on_time:
            result = run_on_time(
                self.costs,
                voters,
                POOL - sum(weights),
                ballots_for_day,
                3,
                on_time,
                payment_tolerance=payment_tolerance,
                lock_supporters=lock_supporters,
            )
        else:
            result = run_daily(
                self.costs,
                voters,
                POOL - sum(weights),
                ballots_for_day,
                3,
                max_days,
                accept,
                hours,
                baseline,
                newcomers == "wait",
                payment_tolerance,
                lock_supporters,
            )
        result["attackers"] = attackers
        result["hours_after_deadline"] = sum(24 if d["hours"] is None else d["hours"] for d in result["days"][1:])
        result["voters"] = [(weights[i], b) for i, b in enumerate(result["ballots"])]
        return result

    # ------------------------------------------------------------- measures

    def flips_from_new_ballots(self, count, rng):
        """How many proposals change result when `count` holders who had not voted by
        the deadline submit a ballot, everything else staying as it was."""
        present = [a is not None and a <= 1 for a in self.arrival]

        def result():
            share = POOL // sum(present)
            voters = [(share, self.ballot(i)) if present[i] else (0, None) for i in range(self.n)]
            return set(tally(self.costs, voters, POOL - share * sum(present))[0])

        before = result()
        for i in rng.sample([i for i in range(self.n) if not present[i]], count):
            present[i] = True
        return len(before ^ result())

    def first_deadline(self):
        """The plain result at the deadline and what it settles, with each rule's tally
        of those same ballots."""
        profile = self.profiles("deadline")
        window, loose0 = profile(0, list(range(self.m)), [])
        snapshot = set(tally(self.costs, window, loose0)[0])
        deadline, loose = profile(1, list(range(self.m)), [])
        funded, paid, _ = tally(self.costs, deadline, loose)
        contested = {c for c in range(self.m) if (c in funded) != (c in snapshot)}
        locked_in = [c for c in funded if c not in contested]
        locked_out = {c for c in range(self.m) if c not in funded and c not in contested}
        charges = {}
        for c in locked_in:
            for i, d in paid[c].items():
                charges[i] = charges.get(i, 0) + d
        again = {
            rule: tally(self.costs, deadline, loose, rule, locked_in, locked_out, charges)[0] for rule in RULES
        }
        reduced_costs, reduced, keep = remove_projects(self.costs, deadline, locked_out)
        removed = [keep[c] for c in tally(reduced_costs, reduced, loose, "replay", [keep.index(c) for c in locked_in])[0]]
        return {
            "funded": funded,
            "contested": contested,
            "locked_in": locked_in,
            "locked_out": locked_out,
            "again": again,
            "removed": removed,
        }

    def dollars(self, proposals):
        return sum(self.costs[c] for c in proposals) / 10**6

    def overpaid(self, outcome):
        """How much weight was used beyond the voters' shares: each voter's frozen
        charges plus what it paid in the last tally, above its share. Dollars and
        number of voters."""
        spent = {} if outcome["rule"] == "replay" else dict(outcome["charges"])
        for c, shares in outcome["paid"].items():
            for i, d in shares.items():
                spent[i] = spent.get(i, 0) + d
        over = [s - outcome["voters"][i][0] for i, s in spent.items() if s > outcome["voters"][i][0]]
        return sum(over) / 10**6, len(over)

    def group_gap(self, outcome_voters, funded):
        """Half the summed distance between each group's share of the voters and its
        category's share of the money spent: 0 is perfectly proportional by group."""
        present = [self.group[i] for i, (_, ballot) in enumerate(outcome_voters) if ballot is not None]
        spent = sum(self.costs[c] for c in funded) or 1
        gap = 0
        for g in range(self.groups):
            voters_share = present.count(g) / len(present)
            money_share = sum(self.costs[c] for c in funded if self.category[c] == g) / spent
            gap += abs(voters_share - money_share)
        return gap / 2

    def group_money(self, group, funded):
        return self.dollars(c for c in funded if self.category[c] == group)

    def group_paid(self, group, outcome):
        total = 0
        if outcome["rule"] != "replay":
            total = sum(d for i, d in outcome["charges"].items() if self.group[i] == group)
        for shares in outcome["paid"].values():
            total += sum(d for i, d in shares.items() if self.group[i] == group)
        return total / 10**6


def summarize(rounds):
    rows = {rule: [] for rule in RULES}
    deadlines = []
    for seed in range(rounds):
        world = World(seed)
        deadlines.append((world, world.first_deadline()))
        for rule in RULES:
            outcome = world.play(rule)
            fresh = tally(world.costs, outcome["voters"], POOL - sum(w for w, _ in outcome["voters"]))[0]
            rows[rule].append(
                {
                    "extensions": outcome["extensions"],
                    "open": len(outcome["contested"][-1]),
                    "differs": len(set(outcome["funded"]) ^ set(fresh)),
                    "differs_usd": world.dollars(set(outcome["funded"]) ^ set(fresh)),
                    "overpaid": world.overpaid(outcome),
                    "gap": world.group_gap(outcome["voters"], outcome["funded"]),
                    "fresh_gap": world.group_gap(outcome["voters"], fresh),
                    "forced": len(outcome["forced"]),
                    "funded": len(outcome["funded"]),
                }
            )
    return rows, deadlines


def mean(values):
    values = list(values)
    return sum(values) / len(values)


def main(rounds):
    rows, deadlines = summarize(rounds)
    print(f"{rounds} rounds, 200 holders x {World(0).m} proposals, pool $1,000,000\n")
    print("At the first deadline (same for every rule):")
    print(f"  funded proposals        {mean(len(d['funded']) for _, d in deadlines):6.1f}")
    print(f"  locked in               {mean(len(d['locked_in']) for _, d in deadlines):6.1f}")
    print(f"  contested               {mean(len(d['contested']) for _, d in deadlines):6.1f}")
    print(f"  rounds with an extension {sum(bool(d['contested']) for _, d in deadlines):5d}\n")
    print("Tallying the deadline ballots again with the settled proposals held fixed:")
    for rule in RULES:
        changed = [len(set(d["again"][rule]) ^ set(d["funded"])) for _, d in deadlines if d["contested"]]
        print(f"  {rule:7} result changes in {sum(c > 0 for c in changed):3d} rounds, {mean(changed):5.2f} proposals on average")
    changed = [len(set(d["removed"]) ^ set(d["funded"])) for _, d in deadlines if d["contested"]]
    print(f"  replay with locked-out proposals taken off the ballots: {sum(c > 0 for c in changed)} rounds, {mean(changed):.2f} proposals\n")
    print("Whole rounds, voters responding during extensions:")
    print("  rule     extensions  still open  differs from fresh tally  overpaid          group gap (fresh)")
    for rule in RULES:
        r = rows[rule]
        print(
            f"  {rule:7}  {mean(x['extensions'] for x in r):9.2f}  {mean(x['open'] for x in r):10.2f}"
            f"  {mean(x['differs'] for x in r):6.2f} props ${mean(x['differs_usd'] for x in r):9,.0f}"
            f"  ${mean(x['overpaid'][0] for x in r):9,.0f} {mean(x['overpaid'][1] for x in r):5.1f} voters"
            f"  {mean(x['gap'] for x in r):.3f} ({mean(x['fresh_gap'] for x in r):.3f})"
        )
    rng = random.Random(0)
    one = [world.flips_from_new_ballots(1, rng) for world, _ in deadlines for _ in range(4)]
    print(f"\nOne new ballot after the deadline changes {mean(one):.1f} proposals' results on average,")
    print(f"and none in {sum(f == 0 for f in one)} of {len(one)} tries.")
    print("\nOne group drops every locked-in proposal from its ballots during the extension:")
    print("  rule     group's category funded (honest -> dodging)   group paid (honest -> dodging)")
    for rule in RULES:
        gains, pays = [], []
        for seed in range(rounds):
            honest = World(seed)
            group = honest.late_group
            dodging = World(seed, dodging_group=group)
            a, b = honest.play(rule), dodging.play(rule)
            if not a["extensions"]:
                continue
            gains.append((honest.group_money(group, a["funded"]), dodging.group_money(group, b["funded"])))
            pays.append((honest.group_paid(group, a), dodging.group_paid(group, b)))
        print(
            f"  {rule:7}  ${mean(g[0] for g in gains):9,.0f} -> ${mean(g[1] for g in gains):9,.0f}"
            f"                 ${mean(p[0] for p in pays):9,.0f} -> ${mean(p[1] for p in pays):9,.0f}"
        )


def main_steps(rounds):
    print("\nQuiet Ending in steps (a pause after every funded proposal):")
    pauses, one, others, everyone = [], [], [], []
    for seed in range(rounds):
        world = World(seed)
        group = world.late_group
        plain = world.play_in_steps()["funded"]
        members = [i for i in range(world.n) if world.group[i] == group]
        active = world.play_in_steps(members)["funded"]
        crowd = world.play_in_steps(range(world.n))["funded"]
        pauses.append(len(plain))
        one.append((world.group_money(group, plain), world.group_money(group, active)))
        others.append((world.dollars(plain) - one[-1][0], world.dollars(active) - one[-1][1]))
        everyone.append(len(set(crowd) ^ set(plain)))
    print(f"  pauses per round (one per funded proposal)          {mean(pauses):6.1f}")
    print(f"  one group revises at every pause, nobody else does:")
    print(f"    its category's funding   ${mean(a for a, _ in one):9,.0f} -> ${mean(b for _, b in one):9,.0f}")
    print(f"    everyone else's          ${mean(a for a, _ in others):9,.0f} -> ${mean(b for _, b in others):9,.0f}")
    print(f"  everyone revises: {mean(everyone):.1f} proposals differ from the plain result")


def main_levels(rounds):
    print("\nQuiet Ending by level, counted part of each ballot locked, everyone reacting:")
    runs = []
    for seed in range(rounds):
        world = World(seed)
        plain = world.play_in_steps()["funded"]
        result = world.play_by_level(range(world.n))
        loose = POOL - sum(w for w, _ in result["voters"])
        fresh = tally(world.costs, result["voters"], loose)[0]
        runs.append((world, plain, result, fresh))
    print(f"  pauses per round            {mean(len(r['days']) for _, _, r, _ in runs):5.1f}"
          f"  (from {min(len(r['days']) for _, _, r, _ in runs)} to {max(len(r['days']) for _, _, r, _ in runs)})")
    print(f"  proposals that end up different from the deadline tally   {mean(len(set(p) ^ set(r['funded'])) for _, p, r, _ in runs):5.1f}")
    print(f"  rounds ending on the plain tally of the final ballots     {sum(r['funded'] == f for _, _, r, f in runs)} of {rounds}")
    print("  day  rounds  level  funded that day  pool spent  ballots revised  fully locked  out of weight")
    for day in range(max(len(r["days"]) for _, _, r, _ in runs)):
        rows = [r["days"][day] for _, _, r, _ in runs if len(r["days"]) > day]
        print(
            f"  {day + 1:3d}  {len(rows):6d}  {mean(d['level'] for d in rows):5.1f}  {mean(d['funded'] for d in rows):15.1f}"
            f"  {mean(d['spent'] for d in rows):9.0%}  {mean(d['revised'] for d in rows):15.1f}"
            f"  {mean(d['fully_locked'] for d in rows):11.0%}  {mean(d['out_of_weight'] for d in rows):12.0%}"
        )
    print("\n  A campaign for the best-liked proposal the deadline tally leaves unfunded,")
    print("  started at one pause, nobody else reacting:")
    print("  day  tried  funded  supporters who could still move it")
    for day in (1, 2, 3, 5, 8, 12):
        tried = won = 0
        movers = []
        for world, plain, _, _ in runs:
            likes = [0] * world.m
            for i in range(world.n):
                if world.arrival[i] is not None and world.arrival[i] <= 1:
                    for c in sorted(range(world.m), key=lambda c: -world.utility[i][c])[: world.favourites]:
                        likes[c] += 1
            target = max((c for c in range(world.m) if c not in plain), key=lambda c: likes[c])
            result = world.play_by_level(campaign=(day, target))
            if len(result["days"]) < day:
                continue
            tried += 1
            won += target in result["funded"]
            movers.append(result["days"][day - 1]["revised"])
        if tried:
            print(f"  {day:3d}  {tried:5d}  {won:6d}  {mean(movers):8.1f}")


def main_daily(rounds):
    print("\nQuiet Ending by tiers with a daily tally (accepted = funded in two tallies a day apart):")
    print("  accept  payers locked  days  S / A / B / rest  forced  accepted at deadline  vs deadline tally  vs plain tally of final ballots")
    for accept in ("prefix", "both"):
        for payers_locked in (True, False):
            rows = []
            for seed in range(rounds):
                world = World(seed)
                plain = world.play_in_steps()["funded"]
                result = world.play_daily(accept, payers_locked=payers_locked)
                fresh = tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]
                per_stage = [sum(1 for d in result["days"] if d["stage"] == stage) for stage in range(4)]
                rows.append(
                    (
                        len(result["days"]),
                        per_stage,
                        len(result["forced"]),
                        result["days"][0]["accepted"],
                        len(set(result["funded"]) ^ set(plain)),
                        len(set(result["funded"]) ^ set(fresh)),
                        result["funded"] == fresh,
                    )
                )
            stages = " / ".join(f"{mean(r[1][k] for r in rows):.1f}" for k in range(4))
            print(
                f"  {accept:6}  {str(payers_locked):13}  {mean(r[0] for r in rows):4.1f}  {stages}  {mean(r[2] for r in rows):6.2f}"
                f"  {mean(r[3] for r in rows):20.1f}  {mean(r[4] for r in rows):17.1f}  {mean(r[5] for r in rows):6.2f} proposals, equal in {sum(r[6] for r in rows)} of {rounds}"
            )


def main_schedules(rounds):
    print("\nThe same, accepting in tally order with payers locked, under three schedules:")
    print("  schedule                          hours after deadline (mean, max)  tallies  stages closed by the schedule  vs plain tally of final ballots")
    schedules = [
        ("a tally every 24 h, 6 per tier", None),
        ("24 12 6 3 1.5 h, once per round", (24, 1, False)),
        ("24 12 6 3 1.5 h, again each tier", (24, 1, True)),
    ]
    for label, hours in schedules:
        rows = []
        for seed in range(rounds):
            world = World(seed)
            result = world.play_daily(hours=hours)
            fresh = tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]
            rows.append(
                (
                    result["hours_after_deadline"],
                    len(result["days"]),
                    sum(d["closed_by_schedule"] for d in result["days"]),
                    len(set(result["funded"]) ^ set(fresh)),
                    result["funded"] == fresh,
                )
            )
        print(
            f"  {label:32}  {mean(r[0] for r in rows):6.1f} {max(r[0] for r in rows):6.1f}"
            f"                    {mean(r[1] for r in rows):5.1f}  {mean(r[2] for r in rows):16.2f}"
            f"  {mean(r[3] for r in rows):5.2f} proposals, equal in {sum(r[4] for r in rows)} of {rounds}"
        )


def main_newcomers(rounds):
    print("\nOne quiet ending per tier, accepting in tally order, by how late first ballots are handled:")
    print("  newcomers  share      voters counted  accepted at deadline  hours after deadline (mean, max)  extensions  unspent     vs plain tally of final ballots")
    for newcomers in ("closed", "percent", "units", "wait"):
        rows = []
        for seed in range(rounds):
            world = World(seed)
            result = world.play_daily(hours=(24, 1, True), newcomers=newcomers)
            plain = tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]
            rows.append(
                (
                    max(w for w, _ in result["voters"]) / 10**6,
                    sum(b is not None for b in result["ballots"]),
                    result["days"][0]["accepted"],
                    result["hours_after_deadline"],
                    len(result["days"]) - 4,
                    (POOL - result["spent"]) / 10**6,
                    len(set(result["funded"]) ^ set(plain)),
                )
            )
        print(
            f"  {newcomers:9}  ${mean(r[0] for r in rows):7,.0f}  {mean(r[1] for r in rows):14.1f}  {mean(r[2] for r in rows):20.1f}"
            f"  {mean(r[3] for r in rows):8.1f} {max(r[3] for r in rows):6.1f}                   {mean(r[4] for r in rows):10.2f}"
            f"  ${mean(r[5] for r in rows):8,.0f}  {mean(r[6] for r in rows):5.2f} proposals, equal in {sum(r[6] == 0 for r in rows)} of {rounds}"
        )


def without(ballot, proposal):
    """`ballot` with `proposal` left unplaced and nothing else moved."""
    tiers = [[c for c in range(len(ballot)) if ballot[c] == r and c != proposal] for r in sorted({r for r in ballot if r})]
    return rearranged_below(ballot, 0, tiers)


def step_out(world, seen, members):
    """What a group does with the ballots it can see (`seen`, a `(weight, ballot)`
    list): it takes off its own ballots, one by one, each funded proposal it would pay
    for, keeping the removal whenever the tally of what it sees still funds the
    proposal. Returns the group's new ballots by holder."""
    view = list(seen)
    loose = POOL - sum(w for w, _ in view)
    mine = [i for i in members if view[i][1] is not None]
    funded, paid, _ = tally(world.costs, view, loose)
    bill = {c: sum(paid[c].get(i, 0) for i in mine) for c in funded}
    for c in sorted((c for c in funded if bill[c]), key=lambda c: -bill[c]):
        before = {i: view[i] for i in mine}
        for i in mine:
            view[i] = (view[i][0], without(view[i][1], c))
        if c not in tally(world.costs, view, loose)[0]:
            for i, old in before.items():
                view[i] = old
    return {i: view[i][1] for i in mine}


def sealed_day(world, groups, sealed, quiet_last_day=False):
    """A plain round with a hard deadline in which `groups` (lists of holders) each try
    to step out. With `sealed` the last day's ballots are hidden until the deadline, so
    each group plans on the live result of a day before and cannot see the others;
    without it they move one after another on the live result of the last moment. With
    `quiet_last_day` only three other holders vote on the last day. Returns the honest
    result and the result with the groups stepping out."""
    arrival = list(world.arrival)
    if quiet_last_day:
        for i in [i for i, a in enumerate(arrival) if a == 1][3:]:
            arrival[i] = 0
    present = [a is not None and a <= 1 for a in arrival]
    share = POOL // sum(present)
    loose = POOL - share * sum(present)
    final = [(share, world.ballot(i)) if present[i] else (0, None) for i in range(world.n)]
    early_share = POOL // sum(a == 0 for a in arrival)
    early = [(early_share, world.ballot(i)) if arrival[i] == 0 else (0, None) for i in range(world.n)]
    honest = tally(world.costs, final, loose)[0]
    actual = list(final)
    for members in groups:
        members = [i for i in members if arrival[i] == 0]
        for i, ballot in step_out(world, early if sealed else actual, members).items():
            actual[i] = (share, ballot)
    return honest, tally(world.costs, actual, loose)[0]


def main_sealed(rounds):
    print("\nA hard deadline with the last day's ballots public or sealed, groups stepping out:")
    print("  last day  other voters that day  groups  their categories funded (honest -> attack)  proposals lost  proposals changed")
    for quiet in (False, True):
        for sealed in (False, True):
            for count in (1, 2, 3):
                rows = []
                for seed in range(rounds):
                    world = World(seed)
                    order = sorted(range(world.groups), key=world.group.count, reverse=True)[:count]
                    groups = [[i for i in range(world.n) if world.group[i] == g] for g in order]
                    honest, attacked = sealed_day(world, groups, sealed, quiet)
                    rows.append(
                        (
                            sum(world.group_money(g, honest) for g in order),
                            sum(world.group_money(g, attacked) for g in order),
                            len(set(honest) - set(attacked)),
                            len(set(honest) ^ set(attacked)),
                            world.dollars(honest) - world.dollars(attacked),
                        )
                    )
                print(
                    f"  {'sealed' if sealed else 'public':8}  {'few' if quiet else 'the late group':21}  {count:6d}"
                    f"  ${mean(r[0] for r in rows):9,.0f} -> ${mean(r[1] for r in rows):9,.0f}"
                    f"                      {mean(r[2] for r in rows):14.2f}  {mean(r[3] for r in rows):17.2f}"
                )


DEFENCES = [
    ("none", dict()),
    ("payments watched (4)", dict(payment_tolerance=20_000 * 10**6)),
    ("supporters locked (1)", dict(lock_supporters=True)),
    ("both (1 and 4)", dict(lock_supporters=True, payment_tolerance=20_000 * 10**6)),
]
ONE_MINUTE = (24, 1 / 60, True)  # 24 h, 12 h, ... down to about 84 seconds: 11 windows


def defended(world, attack, defence):
    """One quiet ending per tier, each tier accepted whole, the roll closed at the
    deadline, windows halving down to a minute."""
    return world.play_daily("tier", payers_locked=False, hours=ONE_MINUTE, attack=attack, **defence)


def main_attacks(rounds):
    print("\nA group acting together against one quiet ending per tier (windows halve down to a minute, 11 per tier):")
    print("  attack     defence                tallies for S (max)  hours after deadline  tiers cut off  ballots refused  group pays   group's category  exact")
    for attack in (None, "step out", "flip flop", "fresh"):
        for label, defence in DEFENCES:
            rows = []
            for seed in range(rounds):
                world = World(seed)
                result = defended(world, attack, defence)
                members = result["attackers"] or defended(world, "step out", {})["attackers"]
                group = world.group[members[0]]
                paid = sum(d for shares in result["paid"].values() for i, d in shares.items() if i in members) / 10**6
                plain = tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]
                rows.append(
                    (
                        sum(1 for d in result["days"] if d["stage"] == 0),
                        result["hours_after_deadline"],
                        len(result["forced"]),
                        sum(d["refused"] for d in result["days"]),
                        paid,
                        world.group_money(group, result["funded"]),
                        result["funded"] == plain,
                    )
                )
            print(
                f"  {attack or 'none':9}  {label:21}  {mean(r[0] for r in rows):6.1f} ({max(r[0] for r in rows):2d})"
                f"          {mean(r[1] for r in rows):8.1f}             {sum(r[2] for r in rows):5d}  {mean(r[3] for r in rows):15.1f}"
                f"  ${mean(r[4] for r in rows):8,.0f}  ${mean(r[5] for r in rows):9,.0f}        {sum(r[6] for r in rows)}/{rounds}"
            )


HALF_DAY = (12, 1 / 60)  # 12 h, 6 h, ... down to about 84 seconds: 10 extensions


def on_time(world, attack=None, defence=None, calm=False):
    """A round that extends only when a tier changed, with the roll closed at the
    deadline and each tier's extensions halving from 12 hours down to a minute."""
    return world.play_daily(payers_locked=False, attack=attack, on_time=HALF_DAY, calm=calm, **(defence or {}))


ON_TIME_DEFENCES = DEFENCES + [
    ("both, every open tier", dict(lock_supporters="all", payment_tolerance=20_000 * 10**6)),
]


def main_on_time(rounds):
    print("\nExtending only when a tier changed, against a day's pause after every tier:")
    print("  last day  rule            hours after deadline (mean, max)  ended at deadline  tiers confirmed at deadline  extensions  tiers cut off  exact")
    for calm in (True, False):
        for label, play in (
            ("pause per tier", lambda w: w.play_daily("tier", payers_locked=False, hours=ONE_MINUTE, calm=calm, **DEFENCES[3][1])),
            ("only on change", lambda w: on_time(w, None, DEFENCES[3][1], calm)),
        ):
            rows = []
            for seed in range(rounds):
                world = World(seed)
                result = play(world)
                plain = tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]
                first = result["days"][0]
                rows.append(
                    (
                        result["hours_after_deadline"],
                        len(result["days"]) == 1,
                        len([s for s in first.get("confirmed", [0] if first["quiet"] else []) if s < 3]),
                        len(result["days"]) - (1 if "confirmed" in first else 4),
                        len(result["forced"]),
                        result["funded"] == plain,
                    )
                )
            print(
                f"  {'quiet' if calm else 'busy':8}  {label:14}  {mean(r[0] for r in rows):8.1f} {max(r[0] for r in rows):6.1f}"
                f"                   {sum(r[1] for r in rows):3d}/{rounds}             {mean(r[2] for r in rows):6.2f}"
                f"                     {mean(r[3] for r in rows):6.2f}  {sum(r[4] for r in rows):13d}  {sum(r[5] for r in rows)}/{rounds}"
            )

    print("\nA group acting together against it (each tier's extensions halve from 12 hours down to a minute, 10 per tier):")
    print("  attack          defence                tallies (max)  hours after deadline (mean, max)  tiers cut off  ballots refused  group pays   group's category  exact")
    for attack in (None, "step out", "step out below", "flip flop", "fresh"):
        for label, defence in ON_TIME_DEFENCES:
            rows = []
            for seed in range(rounds):
                world = World(seed)
                result = on_time(world, attack, defence)
                members = result["attackers"] or on_time(world, "step out")["attackers"]
                group = world.group[members[0]]
                paid = sum(d for shares in result["paid"].values() for i, d in shares.items() if i in members) / 10**6
                plain = tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]
                rows.append(
                    (
                        len(result["days"]),
                        result["hours_after_deadline"],
                        len(result["forced"]),
                        sum(d["refused"] for d in result["days"]),
                        paid,
                        world.group_money(group, result["funded"]),
                        result["funded"] == plain,
                    )
                )
            print(
                f"  {attack or 'none':14}  {label:21}  {mean(r[0] for r in rows):6.1f} ({max(r[0] for r in rows):2d})"
                f"    {mean(r[1] for r in rows):8.1f} {max(r[1] for r in rows):6.1f}                {sum(r[2] for r in rows):5d}  {mean(r[3] for r in rows):15.1f}"
                f"  ${mean(r[4] for r in rows):8,.0f}  ${mean(r[5] for r in rows):9,.0f}        {sum(r[6] for r in rows)}/{rounds}"
            )


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_steps(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_levels(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_daily(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_schedules(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_newcomers(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_attacks(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_on_time(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    main_sealed(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
