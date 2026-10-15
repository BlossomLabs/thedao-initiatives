"""Quiet Ending by tiers that extends only when a tier changed (`run_on_time`): the
first tally covers every tier, a quiet round ends at the deadline, and the first tier
that moved stops the comparison there.
"""

import random
import unittest

from pbear import pbear
from quiet_ending_steps import rearranged_below, run_on_time
from test_pbear import random_ballot
from test_quiet_ending_daily import fixed, tiers_of

A, B, C, D = 0, 1, 2, 3


def small_round(rng):
    m = rng.randint(2, 5)
    costs = [rng.randint(1, 10) for _ in range(m)]
    voters = [(rng.randint(1, 10), None if rng.random() < 0.1 else random_ballot(rng, m)) for _ in range(rng.randint(2, 5))]
    return m, costs, voters, rng.randint(0, 3)


class Mechanics(unittest.TestCase):
    def test_a_quiet_round_ends_at_the_deadline_on_the_plain_tally(self):
        rng = random.Random(1)
        for _ in range(2000):
            m, costs, voters, abstaining = small_round(rng)
            result = run_on_time(costs, voters, abstaining, fixed([b for _, b in voters]), payment_tolerance=0)
            self.assertEqual(result["funded"], pbear(costs, voters, abstaining))
            self.assertEqual(len(result["days"]), 1)
            self.assertEqual(result["days"][0]["confirmed"], [0, 1, 2, 3])
            self.assertEqual(result["forced"], [])

    def test_a_change_in_the_second_tier_confirms_the_first_and_extends_the_rest(self):
        # One holder with 6. A is its first tier; on the last day it swaps B for C in
        # its second tier. The first tier is confirmed at the deadline, the second is
        # not, and it is confirmed 12 hours later when nothing else has moved.
        costs = [3, 3, 3]
        voters = [(6, None)]
        result = run_on_time(costs, voters, 0, fixed([[1, 2, 0]], [[1, 0, 2]]))
        first, second = result["days"]
        self.assertEqual((first["confirmed"], first["accepted"], first["hours"]), ([0], 1, 24))
        self.assertEqual((second["stage"], second["confirmed"], second["hours"]), (1, [1, 2, 3], 12))
        self.assertEqual(result["funded"], [A, C])

    def test_a_change_in_the_first_tier_confirms_nothing(self):
        costs = [3, 3, 3]
        voters = [(6, None)]
        result = run_on_time(costs, voters, 0, fixed([[1, 2, 0]], [[2, 1, 0]]))
        first, second = result["days"]
        self.assertEqual((first["confirmed"], first["accepted"]), ([], 0))
        self.assertEqual(second["confirmed"], [0, 1, 2, 3])
        self.assertEqual(result["funded"], [B, A])

    def test_a_tier_below_a_fight_closes_with_it_if_it_stood_still(self):
        # The first tier flips twice and then settles; the second never moved in the
        # last window, so it is confirmed at the same tally, with no window of its own.
        costs = [3, 3, 2]
        voters = [(3, None), (2, None)]
        steady = [0, 0, 1]
        days = fixed([[1, 0, 0], steady], [[0, 1, 0], steady], [[1, 0, 0], steady], [[1, 0, 0], steady])
        result = run_on_time(costs, voters, 0, days)
        self.assertEqual([d["confirmed"] for d in result["days"]], [[], [], [0, 1, 2, 3]])
        self.assertEqual([d["hours"] for d in result["days"]], [24, 12, 6])

    def test_every_tier_starts_its_own_extensions_and_a_fight_is_cut_off(self):
        # Two holders: the first flips its first tier at every tally, the second flips
        # its second tier. The first tier uses up 12, 6, 3 and 1.5 hours and is closed
        # by the schedule; the second tier then gets the same four windows.
        costs = [3, 3, 1, 2, 2]
        voters = [(3, None), (3, None)]

        def flip(day, state):
            first = [1, 0, 0, 0, 0] if day % 2 else [0, 1, 0, 0, 0]
            second = [0, 0, 1, 2, 0] if day % 2 else [0, 0, 1, 0, 2]
            return [first, second]

        result = run_on_time(costs, voters, 0, flip)
        self.assertEqual([d["hours"] for d in result["days"]], [24, 12, 6, 3, 1.5, 12, 6, 3, 1.5])
        self.assertEqual(result["forced"], [0, 1])
        self.assertLess(sum(d["hours"] for d in result["days"][1:]), 2 * 24)

    def test_a_shift_in_who_pays_stops_the_comparison_too(self):
        # X is shared by both holders in the first tally; one of them leaves it on the
        # last day. X is still funded, but the bill moved, so the tier is not confirmed.
        costs = [40, 36, 40, 90]
        voters = [(60, None), (40, None)]
        days = fixed([[1, 2, 0, 0], [1, 0, 2, 0]], [[1, 2, 0, 0], [0, 0, 2, 1]])
        loose = run_on_time(costs, voters, 0, days)
        self.assertEqual(loose["days"][0]["confirmed"], [0])
        watched = run_on_time(costs, voters, 0, days, payment_tolerance=0)
        self.assertEqual((watched["days"][0]["confirmed"], watched["days"][0]["shifted"]), ([], 16))
        locked = run_on_time(costs, voters, 0, days, payment_tolerance=0, lock_supporters="all")
        self.assertEqual((locked["days"][0]["refused"], locked["days"][0]["confirmed"]), (1, [0, 1, 2, 3]))
        self.assertEqual(locked["paid"][0], {0: 24, 1: 16})

    def test_supporters_of_a_lower_tier_are_bound_only_when_every_open_tier_is(self):
        # B is funded in the second tier by both holders. On the last day one of them
        # swaps it for C. Binding the first tier only lets that through and B fails;
        # binding every open tier refuses it.
        costs = [4, 6, 3]
        voters = [(5, None), (5, None)]
        days = fixed([[1, 2, 0], [1, 2, 0]], [[1, 2, 0], [1, 0, 2]])
        first = run_on_time(costs, voters, 0, days, lock_supporters="first")
        every = run_on_time(costs, voters, 0, days, lock_supporters="all")
        self.assertEqual((first["days"][0]["refused"], first["funded"]), (0, [A, C]))
        self.assertEqual((every["days"][0]["refused"], every["funded"]), (1, [A, B]))


class Properties(unittest.TestCase):
    def revised(self, rounds, seed, **options):
        """Random small rounds in which ballots change freely until the deadline and,
        after it, only below the confirmed tiers."""
        rng = random.Random(seed)
        for _ in range(rounds):
            m, costs, voters, abstaining = small_round(rng)
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

            result = run_on_time(costs, voters, abstaining, ballots_for_day, **options)
            final = [(w, b) for (w, _), b in zip(voters, result["ballots"])]
            yield costs, abstaining, voters, final, result

    def test_it_is_the_plain_tally_of_the_final_ballots(self):
        for options in (dict(), dict(payment_tolerance=0), dict(lock_supporters="all"), dict(hours=(12, 1 / 60))):
            revised = cut_off = partial = 0
            for costs, abstaining, voters, final, result in self.revised(6000, 22, **options):
                self.assertEqual(result["funded"], pbear(costs, final, abstaining), options)
                revised += final != voters
                cut_off += bool(result["forced"])
                partial += 0 < len(result["days"][0]["confirmed"]) < 4
            # Binding every supporter refuses many of the random revisions.
            self.assertGreater(revised, 2000)
            self.assertGreater(partial, 150)
            if not options:
                self.assertGreater(revised, 4000)
                self.assertGreater(cut_off, 100)

    def test_the_accounts_balance(self):
        for costs, abstaining, voters, final, result in self.revised(3000, 5):
            budget = sum(w for w, _ in voters) + abstaining
            self.assertEqual(len(result["funded"]), len(set(result["funded"])))
            self.assertLessEqual(sum(costs[c] for c in result["funded"]), budget)
            spent = [0] * len(voters)
            for c in result["funded"]:
                self.assertEqual(sum(result["paid"][c].values()), costs[c])
                for i, d in result["paid"][c].items():
                    spent[i] += d
            for (w, _), s, left in zip(voters, spent, result["weights"]):
                self.assertEqual(w - s, left)
                self.assertGreaterEqual(left, 0)

    def test_no_round_runs_past_a_day_of_extensions_per_tier(self):
        for costs, abstaining, voters, final, result in self.revised(3000, 9):
            after = result["days"][1:]
            self.assertLess(sum(d["hours"] for d in after), 3 * 24)
            for stage in range(3):
                self.assertLess(sum(d["hours"] for d in after if d["stage"] == stage), 24)

    def test_a_confirmed_tier_never_changes(self):
        for costs, abstaining, voters, final, result in self.revised(1500, 3):
            self.assertEqual(sum(d["accepted"] for d in result["days"]), len(result["funded"]))
            self.assertEqual([s for d in result["days"] for s in d["confirmed"]], [0, 1, 2, 3])


if __name__ == "__main__":
    unittest.main()
