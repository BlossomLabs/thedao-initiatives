"""Quiet Ending by tiers with a daily tally: a proposal is accepted only when two
tallies a day apart both fund it, one tier at a time. Tests named `..._cannot_...` or
`..._lets_...` document a property that is lost; they pass when the loss is reproduced.
"""

import random
import unittest

from pbear import is_ipsc, pbear
from quiet_ending import pin_settled
from quiet_ending_steps import rearranged_below, run_daily
from test_pbear import random_ballot

A, B, C = 0, 1, 2


def tiers_of(ballot):
    groups = {}
    for c, r in enumerate(ballot):
        if r:
            groups.setdefault(r, []).append(c)
    return [groups[r] for r in sorted(groups)]


def fixed(*days):
    """Ballots day by day; the last entry stays for the rest of the round."""
    return lambda day, state: list(days[min(day, len(days) - 1)])


def revised_rounds(rule, accept, rounds, seed=13):
    """Random small rounds in which ballots are revised for a few days under `rule`:
    "anything", "allowed" (accepted proposals stay put, tiers of finished stages are
    locked) or "payers locked" (also, whoever paid for an accepted proposal cannot
    change the tier being counted). Yields costs, budget, abstaining, final voters and
    the result of each round where a ballot changed."""
    rng = random.Random(seed)
    for _ in range(rounds):
        m = rng.randint(2, 5)
        costs = [rng.randint(1, 10) for _ in range(m)]
        voters = [(rng.randint(1, 10), random_ballot(rng, m)) for _ in range(rng.randint(2, 5))]
        abstaining = rng.randint(0, 3)
        r = random.Random(rng.random())

        def ballots_for_day(day, state):
            if state is None:
                return [b for _, b in voters]
            if day > 4:
                return state["ballots"]
            payers = {i for shares in state["paid"].values() for i, d in shares.items() if d}
            out = []
            for i, old in enumerate(state["ballots"]):
                if r.random() < 0.6:
                    out.append(old)
                    continue
                new = random_ballot(r, m)
                if rule != "anything":
                    lock = state["locked_level"]
                    if rule == "payers locked" and i in payers:
                        lock = state["stage_level"]
                    new = rearranged_below(old, lock, tiers_of(pin_settled(old, new, set(state["funded"]))))
                out.append(new)
            return out

        result = run_daily(costs, voters, abstaining, ballots_for_day, accept=accept, max_days=8)
        final = [(w, b) for (w, _), b in zip(voters, result["ballots"])]
        if final != voters:
            yield costs, sum(w for w, _ in voters) + abstaining, abstaining, final, result


def departures(rule, accept, rounds=4000):
    revised = unproportional = not_plain = 0
    for costs, budget, abstaining, final, result in revised_rounds(rule, accept, rounds):
        revised += 1
        unproportional += not is_ipsc(costs, budget, final, result["funded"])
        not_plain += set(result["funded"]) != set(pbear(costs, final, abstaining))
    return revised, unproportional, not_plain


class Mechanics(unittest.TestCase):
    def test_without_revisions_it_is_plain_pbear_and_takes_one_day_per_stage(self):
        rng = random.Random(1)
        for accept in ("prefix", "both"):
            for _ in range(400):
                m = rng.randint(2, 5)
                costs = [rng.randint(1, 10) for _ in range(m)]
                voters = [(rng.randint(1, 10), None if rng.random() < 0.1 else random_ballot(rng, m)) for _ in range(4)]
                abstaining = rng.randint(0, 3)
                result = run_daily(costs, voters, abstaining, fixed([b for _, b in voters]), accept=accept)
                self.assertEqual(result["funded"], pbear(costs, voters, abstaining))
                self.assertEqual([d["stage"] for d in result["days"]], [0, 1, 2, 3])
                self.assertEqual(result["forced"], [])

    def test_a_result_that_appears_at_the_deadline_waits_a_day(self):
        # The second holder votes on the last day. B is funded by the deadline tally
        # but was not by the one before, so only A is accepted at the deadline; B is
        # accepted the next day, having stood for two tallies.
        costs = [3, 3]
        voters = [(3, None), (3, None)]
        early, late = [1, 2], [2, 1]
        result = run_daily(costs, voters, 0, fixed([early, None], [early, late]))
        first, second = result["days"][0], result["days"][1]
        self.assertEqual((first["tally"], first["accepted"], first["quiet"]), (2, 1, False))
        self.assertEqual((second["stage"], second["accepted"], second["quiet"]), (0, 1, True))
        self.assertEqual(result["funded"], [A, B])
        self.assertEqual(result["paid"], {A: {0: 3}, B: {1: 3}})

    def test_a_result_that_is_withdrawn_the_next_day_is_never_accepted(self):
        costs = [3, 3]
        voters = [(3, None), (3, None)]
        early, late = [1, 2], [2, 1]
        result = run_daily(costs, voters, 0, fixed([early, None], [early, late], [early, None]))
        self.assertEqual(result["funded"], [A])

    def test_a_fight_that_never_settles_is_closed_by_the_day_limit(self):
        costs = [3, 3]
        voters = [(3, None), (1, None)]
        flip = lambda day, state: [[1, 2] if day % 2 else [2, 1], None]
        result = run_daily(costs, voters, 0, flip, max_days=4)
        self.assertEqual(result["forced"], [0])
        self.assertEqual(sum(1 for d in result["days"] if d["stage"] == 0), 5)
        self.assertEqual(len(result["funded"]), 1)

    def test_a_halving_schedule_ends_the_round_within_two_days_of_the_first_tally(self):
        # Tallies 24, 12, 6, 3 and 1.5 hours apart: the first interval is the quiet
        # window before the deadline, the rest add up to 22.5 hours after it.
        costs = [3, 3]
        voters = [(3, None), (1, None)]
        flip = lambda day, state: [[1, 2] if day % 2 else [2, 1], None]
        result = run_daily(costs, voters, 0, flip, hours=(24, 1, False))
        real = [d["hours"] for d in result["days"] if d["hours"]]
        self.assertEqual(real, [24, 12, 6, 3, 1.5])
        self.assertLess(sum(real), 48)
        # The fight over the first tier lasts the whole schedule and is cut off there;
        # the other stages are closed at the same moment, with no time of their own.
        self.assertEqual(result["forced"], [0])
        self.assertEqual([d["stage"] for d in result["days"]], [0, 0, 0, 0, 0, 1, 2, 3])
        self.assertTrue(all(d["hours"] == 0 for d in result["days"][5:]))
        self.assertEqual(len(result["funded"]), 1)

    def test_restarting_the_schedule_gives_every_tier_its_own_two_days(self):
        costs = [3, 3]
        voters = [(3, None), (1, None)]
        ballots = fixed([[1, 2], None])
        result = run_daily(costs, voters, 0, ballots, hours=(24, 1, True))
        self.assertEqual([(d["stage"], d["hours"]) for d in result["days"]], [(0, 24), (1, 24), (2, 24), (3, 24)])
        once = run_daily(costs, voters, 0, ballots, hours=(24, 1, False))
        self.assertEqual([(d["stage"], d["hours"]) for d in once["days"]], [(0, 24), (1, 12), (2, 6), (3, 3)])
        self.assertEqual(once["funded"], result["funded"])

    def test_a_first_ballot_made_to_wait_is_counted_from_the_next_tally(self):
        # The second holder's ballot arrives on the deadline day. Counted at once, B
        # shows up in the deadline tally and is accepted a day later. Made to wait, it
        # shows up a tally later and is accepted a tally later still, and the first
        # tier cannot close while the ballot is waiting.
        costs = [3, 3]
        voters = [(3, None), (3, None)]
        days = fixed([[1, 2], None], [[1, 2], [2, 1]])
        at_once = run_daily(costs, voters, 0, days)
        waiting = run_daily(costs, voters, 0, days, newcomers_wait=True)
        self.assertEqual(at_once["funded"], waiting["funded"])
        self.assertEqual([(d["stage"], d["tally"], d["accepted"]) for d in at_once["days"][:2]], [(0, 2, 1), (0, 1, 1)])
        first, second, third = waiting["days"][:3]
        self.assertEqual((first["tally"], first["accepted"], first["newcomers"], first["quiet"]), (1, 1, 1, False))
        self.assertEqual((second["stage"], second["tally"], second["accepted"]), (0, 1, 0))
        self.assertEqual((third["stage"], third["accepted"], third["quiet"]), (0, 1, True))

    def test_the_first_baseline_can_come_from_another_tally(self):
        costs = [3, 3]
        voters = [(3, None), (3, None)]
        days = fixed([[1, 2], [2, 1]])
        asked = []
        result = run_daily(costs, voters, 0, lambda day, state: asked.append(day) or days(day, state), baseline={A})
        self.assertNotIn(0, asked)
        self.assertEqual((result["days"][0]["tally"], result["days"][0]["accepted"]), (2, 1))
        self.assertEqual(result["funded"], [A, B])

    def test_the_accounts_balance_whatever_is_revised(self):
        for accept in ("prefix", "both"):
            for costs, budget, _, final, result in revised_rounds("anything", accept, 1500, seed=2):
                self.assertEqual(len(result["funded"]), len(set(result["funded"])))
                self.assertLessEqual(sum(costs[c] for c in result["funded"]), budget)
                paid = [0] * len(final)
                for c in result["funded"]:
                    self.assertEqual(sum(result["paid"][c].values()), costs[c])
                    for i, d in result["paid"][c].items():
                        paid[i] += d
                for (w, _), spent, left in zip(final, paid, result["weights"]):
                    self.assertEqual(w - spent, left)
                    self.assertGreaterEqual(left, 0)


class Properties(unittest.TestCase):
    def test_a_payer_who_rearranges_the_open_tier_lets_the_result_leave_the_plain_tally(self):
        # A costs 2, B and C 4. On the deadline day the big holder is indifferent and
        # pays for A, which is accepted. The S stage is still open because C is new, so
        # the next day the big holder puts B first. It has already paid for A as a
        # first choice; a plain tally of the final ballots would fund B with that
        # money, and A only later.
        costs = [2, 4, 4]
        voters = [(1, None), (5, None)]
        small = [1, 3, 1]
        days = fixed([small, [1, 2, 0]], [small, [0, 0, 0]], [small, [0, 1, 2]])
        result = run_daily(costs, voters, 0, days)
        final = [(1, small), (5, [0, 1, 2])]
        self.assertEqual(set(result["funded"]), {A, C})
        self.assertEqual(set(pbear(costs, final)), {A, B})
        self.assertFalse(is_ipsc(costs, 6, final, result["funded"]))

    def test_free_revisions_break_proportionality_often_and_the_allowed_ones_rarely(self):
        revised, loose, loose_not_plain = departures("anything", "prefix")
        revised_allowed, allowed, allowed_not_plain = departures("allowed", "prefix")
        self.assertGreater(loose / revised, 0.03)
        self.assertGreater(allowed, 0)
        self.assertLess(allowed / revised_allowed, 0.01)
        self.assertLess(allowed_not_plain / revised_allowed, loose_not_plain / revised / 5)

    def test_locking_payers_keeps_proportionality_and_nearly_the_plain_tally(self):
        for accept in ("prefix", "both"):
            revised, unproportional, not_plain = departures("payers locked", accept)
            self.assertGreater(revised, 2000)
            self.assertEqual(unproportional, 0, accept)
            self.assertLess(not_plain / revised, 0.01, accept)

    def test_accepting_in_tally_order_stays_closer_to_the_plain_tally(self):
        _, _, prefix = departures("payers locked", "prefix", 8000)
        _, _, both = departures("payers locked", "both", 8000)
        self.assertLess(prefix, both)


class AcceptingATierWhole(unittest.TestCase):
    def test_accepting_in_order_can_leave_the_plain_tally_with_every_rule_kept(self):
        # A costs 1, B 4, C 2; one holder has 3 and the other 1. At the deadline the
        # big holder backs A and B equally and A is accepted, paid by the big holder.
        # The small holder has paid nothing, so its first tier is still open, and the
        # next day it puts B first. On those final ballots a plain tally funds B before
        # A, because B now has more support, and B takes the whole pool. But A is
        # already paid, so B can no longer be afforded.
        costs = [1, 4, 2]
        voters = [(3, None), (1, None)]
        big = [1, 1, 3]
        days = fixed([[0, 0, 0], [1, 2, 2]], [big, [0, 0, 1]], [big, [0, 1, 0]])
        result = run_daily(costs, voters, 0, days, accept="prefix")
        self.assertEqual(result["funded"], [A, C])
        self.assertEqual(result["paid"][A], {0: 1})
        self.assertEqual(pbear(costs, [(3, big), (1, [0, 1, 0])]), [B])
        whole = run_daily(costs, voters, 0, days, accept="tier")
        self.assertEqual(whole["funded"], [B])

    def test_accepting_each_tier_whole_is_the_plain_tally_of_the_final_ballots(self):
        # Nothing is accepted while a tier is open, so every accepted step is a PB-EAR
        # step on the ballots of the day the tier closed, and those ranks are locked
        # afterwards. The only rule the voters follow here is that lock.
        rng = random.Random(22)
        revised = cut_off = 0
        for _ in range(6000):
            m = rng.randint(2, 5)
            costs = [rng.randint(1, 10) for _ in range(m)]
            voters = [
                (rng.randint(1, 10), None if rng.random() < 0.1 else random_ballot(rng, m))
                for _ in range(rng.randint(2, 5))
            ]
            abstaining = rng.randint(0, 3)
            r = random.Random(rng.random())

            def ballots_for_day(day, state):
                if state is None:
                    return [b for _, b in voters]
                return [
                    old
                    if old is None or r.random() < 0.5
                    else rearranged_below(old, state["locked_level"], tiers_of(random_ballot(r, m)))
                    for old in state["ballots"]
                ]

            result = run_daily(costs, voters, abstaining, ballots_for_day, accept="tier", hours=(24, 1, True))
            final = [(w, b) for (w, _), b in zip(voters, result["ballots"])]
            if final == voters:
                continue
            revised += 1
            cut_off += bool(result["forced"])
            self.assertEqual(result["funded"], pbear(costs, final, abstaining))
        self.assertGreater(revised, 4000)
        self.assertGreater(cut_off, 100)


class WhoPays(unittest.TestCase):
    """X costs 40, Y 36, Z 40, W 90. A majority of 60 wants X then Y; a minority of 40
    wants X then Z. Sharing X, the majority keeps 36 and gets Y. On the last day the
    minority takes X off its ballot (ranking W, which cannot pass, in its place)."""

    costs = [40, 36, 40, 90]
    voters = [(60, None), (40, None)]
    majority = [1, 2, 0, 0]
    sharing = [1, 0, 2, 0]
    withdrawn = [0, 0, 2, 1]

    def test_payments_come_from_the_tally_that_is_accepted(self):
        result = run_daily(
            self.costs, self.voters, 0, fixed([self.majority, self.sharing], [self.majority, self.withdrawn]), accept="tier"
        )
        # Both tallies fund X in the first tier, so it closes at the deadline, and the
        # holders of the deadline ballots pay: the majority alone.
        first = result["days"][0]
        self.assertEqual((first["accepted"], first["quiet"], first["shifted"]), (1, True, 16))
        self.assertEqual(result["paid"][0], {0: 40})

    def test_a_last_day_withdrawal_shifts_the_cost_without_changing_the_first_tier(self):
        honest = run_daily(self.costs, self.voters, 0, fixed([self.majority, self.sharing]), accept="tier")
        self.assertEqual(honest["paid"][0], {0: 24, 1: 16})
        self.assertEqual(honest["funded"], [0, 1])
        late = run_daily(
            self.costs, self.voters, 0, fixed([self.majority, self.sharing], [self.majority, self.withdrawn]), accept="tier"
        )
        # The funded set of the first tier is the same, so nobody is given time to
        # answer; the majority is left with 20, Y fails and the minority's Z passes.
        self.assertEqual(late["funded"], [0, 2])
        self.assertEqual(late["funded"], pbear(self.costs, [(60, self.majority), (40, self.withdrawn)]))

    def test_watching_payments_keeps_the_tier_open_for_another_tally(self):
        days = fixed([self.majority, self.sharing], [self.majority, self.withdrawn])
        watched = run_daily(self.costs, self.voters, 0, days, accept="tier", payment_tolerance=0)
        first, second = watched["days"][0], watched["days"][1]
        self.assertEqual((first["stage"], first["accepted"], first["quiet"], first["shifted"]), (0, 0, False, 16))
        self.assertEqual((second["stage"], second["accepted"], second["quiet"], second["shifted"]), (0, 1, True, 0))
        # If nobody answers, the result is the same one a tally later, and still the
        # plain tally of the final ballots.
        self.assertEqual(watched["funded"], [0, 2])


    def test_a_donation_lowers_the_bill_without_counting_as_a_shift(self):
        # Between the two tallies a donation takes 10 off X's ask. Everyone pays less,
        # in the same proportions, so nothing has shifted and the tier closes, even
        # with no tolerance at all.
        asks = lambda day: [40 if day == 0 else 30, 36, 40, 90]
        days = fixed([self.majority, self.sharing])
        result = run_daily(self.costs, self.voters, 0, days, accept="tier", payment_tolerance=0, asks_for_day=asks)
        first = result["days"][0]
        self.assertEqual((first["accepted"], first["quiet"], first["shifted"]), (1, True, 0))
        self.assertEqual(result["paid"][0], {0: 18, 1: 12})
        self.assertEqual(result["spent"], sum(sum(shares.values()) for shares in result["paid"].values()))

    def test_a_donation_that_changes_the_result_extends_the_tier(self):
        # W asks 90 and cannot pass. A donation of 70 during the window brings it within
        # the minority's reach. No ballot changed, yet the tier's result did, so it is
        # not confirmed that day.
        costs = [40, 36, 40, 90]
        asks = lambda day: costs if day == 0 else [40, 36, 40, 20]
        minority = [1, 0, 3, 1]
        days = fixed([self.majority, minority])
        result = run_daily(costs, self.voters, 0, days, accept="tier", asks_for_day=asks)
        first, second = result["days"][0], result["days"][1]
        self.assertEqual((first["stage"], first["tally"], first["accepted"], first["quiet"]), (0, 2, 0, False))
        self.assertEqual((second["stage"], second["accepted"], second["quiet"]), (0, 2, True))
        self.assertIn(3, result["funded"])

    def test_locking_supporters_refuses_the_withdrawal(self):
        days = fixed([self.majority, self.sharing], [self.majority, self.withdrawn])
        locked = run_daily(self.costs, self.voters, 0, days, accept="tier", lock_supporters=True)
        self.assertEqual(locked["days"][0]["refused"], 1)
        self.assertEqual(locked["paid"][0], {0: 24, 1: 16})
        self.assertEqual(locked["funded"], [0, 1])

    def test_a_locked_supporter_may_still_add_to_the_tier(self):
        # Adding W beside X leaves X's rank alone, so the ballot is accepted, and since
        # W cannot pass it changes nothing about who pays for X.
        padded = [1, 0, 3, 1]
        days = fixed([self.majority, self.sharing], [self.majority, padded])
        locked = run_daily(self.costs, self.voters, 0, days, accept="tier", lock_supporters=True)
        self.assertEqual(locked["days"][0]["refused"], 0)
        self.assertEqual(locked["ballots"][1], padded)
        self.assertEqual(locked["paid"][0], {0: 24, 1: 16})

    def test_leaving_before_the_baseline_is_not_refused(self):
        days = fixed([self.majority, self.withdrawn])
        locked = run_daily(self.costs, self.voters, 0, days, accept="tier", lock_supporters=True)
        self.assertEqual(sum(d["refused"] for d in locked["days"]), 0)
        self.assertEqual(locked["paid"][0], {0: 40})


if __name__ == "__main__":
    unittest.main()
