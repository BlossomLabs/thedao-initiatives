"""What Quiet Ending keeps and what it gives up, measured against plain PB-EAR.

The proposal text leaves open who pays for a locked-in proposal once the tally runs
again. `quiet_ending` models three readings (`reset`, `replay`, `frozen`); these tests
pin down, with small examples and random instances, which of PB-EAR's properties each
one keeps. Tests named `..._breaks_...` or `..._cannot_...` document a property that is
lost, on purpose: they pass when the loss is reproduced.
"""

import random
import unittest

from pbear import is_ipsc, pbear, validate_ballot
from quiet_ending import RULES, extension_lengths, pin_settled, remove_projects, run_round, tally
from test_pbear import random_ballot

X, Y, Z = 0, 1, 2


def random_round(rng, checkpoints):
    """Costs, an abstaining amount and `checkpoints` successive ballot profiles of the
    same voters, each profile changing about half of the ballots of the one before."""
    m = rng.randint(2, 5)
    costs = [rng.randint(1, 10) for _ in range(m)]
    weights = [rng.randint(1, 10) for _ in range(rng.randint(2, 6))]
    profiles = [[(w, None if rng.random() < 0.3 else random_ballot(rng, m)) for w in weights]]
    for _ in range(checkpoints - 1):
        profiles.append([(w, random_ballot(rng, m)) if rng.random() < 0.5 else (w, b) for w, b in profiles[-1]])
    return costs, rng.randint(0, 5), profiles


def settle(costs, before, after, abstaining=0):
    """What the first deadline settles: the plain result of `after`, the proposals
    locked in and out because they match the plain result of `before`, the contested
    rest, and what each voter paid for the locked-in ones."""
    snapshot = set(pbear(costs, before, abstaining))
    funded, paid, _ = tally(costs, after, abstaining)
    contested = {c for c in range(len(costs)) if (c in funded) != (c in snapshot)}
    locked_in = [c for c in funded if c not in contested]
    locked_out = {c for c in range(len(costs)) if c not in funded and c not in contested}
    charges = {}
    for c in locked_in:
        for i, d in paid[c].items():
            charges[i] = charges.get(i, 0) + d
    return funded, locked_in, locked_out, contested, charges


class TwoGroups(unittest.TestCase):
    """A majority of 60 that likes X and Y equally and a minority of 40 that only wants
    Z. X costs 40, Y 50, Z 40, and the budget is 100. Plain PB-EAR funds X for the
    majority, which leaves it 20, and then Z for the minority.

    When the quiet window opens only 30 of the minority have voted, so Z is short and Y
    is funded instead. The last 10 arrive before the deadline: Y and Z flip and are
    contested, X held and is locked in."""

    costs = [40, 50, 40]
    majority = [1, 1, 3]
    minority = [0, 0, 1]
    window = [(60, majority), (30, minority), (10, None)]
    deadline = [(60, majority), (30, minority), (10, minority)]

    def setUp(self):
        self.funded, self.locked_in, self.locked_out, self.contested, self.charges = settle(
            self.costs, self.window, self.deadline
        )

    def settled(self, rule, voters):
        return tally(self.costs, voters, 0, rule, self.locked_in, self.locked_out, self.charges)

    def test_the_deadline_settles_x_and_contests_y_and_z(self):
        self.assertEqual(pbear(self.costs, self.window), [X, Y])
        self.assertEqual(self.funded, [X, Z])
        self.assertEqual((self.locked_in, self.locked_out, self.contested), ([X], set(), {Y, Z}))
        self.assertEqual(self.charges, {0: 40})

    def test_reset_breaks_proportionality_by_counting_used_votes_again(self):
        # The majority already spent 40 of its 60 on X. Tallied at full weight it
        # outvotes the minority for the 60 that is left and takes Y as well.
        funded, _, _ = self.settled("reset", self.deadline)
        self.assertEqual(funded, [X, Y])
        self.assertFalse(is_ipsc(self.costs, 100, self.deadline, funded))

    def test_reset_breaks_the_result_without_anyone_changing_a_ballot(self):
        # The deadline announced Z as funded. With the same ballots the extension ends
        # with Y instead, so the two are contested again.
        outcome = run_round(self.costs, [self.window, self.deadline, self.deadline], rule="reset")
        self.assertEqual(outcome["funded"], [X, Y])
        self.assertEqual(outcome["contested"], [[Y, Z], [Y, Z]])

    def test_replay_and_frozen_count_only_the_weight_that_is_left(self):
        for rule in ("replay", "frozen"):
            funded, _, _ = self.settled(rule, self.deadline)
            self.assertEqual(set(funded), {X, Z}, rule)
            self.assertTrue(is_ipsc(self.costs, 100, self.deadline, funded), rule)
            outcome = run_round(self.costs, [self.window, self.deadline, self.deadline], rule=rule)
            self.assertEqual(set(outcome["funded"]), {X, Z}, rule)
            self.assertEqual(outcome["contested"], [[Y, Z], []], rule)

    def test_replay_charges_the_supporters_of_the_locked_in_proposal(self):
        _, paid, forced = self.settled("replay", self.deadline)
        self.assertEqual(paid[X], {0: 40})
        self.assertEqual(paid[Z], {1: 30, 2: 10})
        self.assertEqual(forced, [])

    def test_replay_cannot_stop_supporters_from_dropping_a_locked_in_proposal(self):
        # During the extension the majority takes X off its ballot. X is locked in, so
        # nothing is risked; the majority now spends 50 on Y, and X is paid by the
        # minority, whose unranked proposals share its last tier. The minority pays 40
        # and gets nothing.
        dodge = [(60, [0, 1, 2]), (30, self.minority), (10, self.minority)]
        funded, paid, _ = self.settled("replay", dodge)
        self.assertEqual(set(funded), {X, Y})
        self.assertEqual(paid[X], {1: 30, 2: 10})
        self.assertEqual(paid[Y], {0: 50})

    def test_frozen_keeps_the_charge_when_supporters_drop_a_locked_in_proposal(self):
        dodge = [(60, [0, 1, 2]), (30, self.minority), (10, self.minority)]
        funded, paid, _ = self.settled("frozen", dodge)
        self.assertEqual(set(funded), {X, Z})
        self.assertEqual(paid[Z], {1: 30, 2: 10})


    def test_pinning_settled_proposals_closes_the_replay_loophole(self):
        # If a ballot may only move contested proposals, X stays in the majority's top
        # tier whatever it submits, and the majority goes on paying for it.
        dodge = [0, 1, 2]
        pinned = pin_settled(self.majority, dodge, {X})
        self.assertEqual(pinned, [1, 1, 3])
        voters = [(60, pinned), (30, self.minority), (10, self.minority)]
        funded, paid, _ = self.settled("replay", voters)
        self.assertEqual(set(funded), {X, Z})
        self.assertEqual(paid[X], {0: 40})


class Pinning(unittest.TestCase):
    def test_contested_proposals_move_and_settled_ones_stay_in_their_tier(self):
        # Tiers [0] [1, 2] [3], 4 unplaced. The voter promotes 3 to the top, demotes 1
        # and tries to drop 0 and place 4; 0 and 4 are settled.
        old = [1, 2, 2, 4, 0]
        new = [0, 3, 2, 1, 2]
        self.assertEqual(pin_settled(old, new, {0, 4}), [1, 4, 3, 1, 0])

    def test_nothing_settled_or_a_first_ballot_is_left_alone(self):
        self.assertEqual(pin_settled([1, 2, 0], [2, 1, 0], set()), [2, 1, 0])
        self.assertEqual(pin_settled(None, [2, 1, 0], {0}), [2, 1, 0])
        self.assertIsNone(pin_settled([1, 2, 0], None, {0}))

    def test_pinned_ballots_are_valid_rankings(self):
        rng = random.Random(21)
        for _ in range(500):
            m = rng.randint(1, 6)
            old, new = random_ballot(rng, m), random_ballot(rng, m)
            settled = {c for c in range(m) if rng.random() < 0.5}
            pinned = pin_settled(old, new, settled)
            validate_ballot(pinned, m)
            for c in range(m):
                self.assertEqual(pinned[c] == 0, (old[c] if c in settled else new[c]) == 0)


class NothingSettled(unittest.TestCase):
    def test_every_rule_is_plain_pbear_while_nothing_is_settled(self):
        rng = random.Random(1)
        for _ in range(500):
            costs, abstaining, (voters,) = random_round(rng, 1)
            for rule in RULES:
                self.assertEqual(tally(costs, voters, abstaining, rule)[0], pbear(costs, voters, abstaining))

    def test_a_quiet_window_closes_on_time_with_the_plain_result(self):
        rng = random.Random(2)
        quiet = 0
        for _ in range(2000):
            costs, abstaining, profiles = random_round(rng, 3)
            if set(pbear(costs, profiles[0], abstaining)) != set(pbear(costs, profiles[1], abstaining)):
                continue
            quiet += 1
            for rule in RULES:
                outcome = run_round(costs, profiles, abstaining, rule)
                self.assertEqual(outcome["funded"], pbear(costs, profiles[1], abstaining))
                self.assertEqual(outcome["extensions"], 0)
        self.assertGreater(quiet, 100)


class UnchangedBallots(unittest.TestCase):
    """If nobody touches a ballot during an extension, the result announced at the
    deadline should stand."""

    def test_replay_always_reproduces_the_deadline_result(self):
        rng = random.Random(3)
        extended = 0
        for _ in range(3000):
            costs, abstaining, (before, after) = random_round(rng, 2)
            funded, locked_in, locked_out, contested, _ = settle(costs, before, after, abstaining)
            if not contested:
                continue
            extended += 1
            again, _, forced = tally(costs, after, abstaining, "replay", locked_in, locked_out)
            self.assertEqual(again, funded)
            self.assertEqual(forced, [])
        self.assertGreater(extended, 500)

    def test_frozen_breaks_the_deadline_result_in_rare_cases(self):
        # A costs 1, B 3, C 1. The big voter is indifferent; the small one arrives in
        # the window wanting B. Plain PB-EAR funds B with both of them and then A with
        # the small voter's last unit. A held, so that unit is frozen. Charged up
        # front, the small voter has nothing to add to B, which loses to C.
        costs = [1, 3, 1]
        before = [(1, None), (3, [0, 0, 0])]
        after = [(1, [0, 1, 0]), (3, [0, 0, 0])]
        funded, locked_in, locked_out, contested, charges = settle(costs, before, after)
        self.assertEqual((funded, locked_in, contested), ([1, 0], [0], {1, 2}))
        again, _, _ = tally(costs, after, 0, "frozen", locked_in, locked_out, charges)
        self.assertEqual(again, [0, 2])

    def test_frozen_differs_from_the_deadline_result_far_less_often_than_reset(self):
        rng = random.Random(3)
        differs = {"reset": 0, "frozen": 0}
        extended = 0
        for _ in range(3000):
            costs, abstaining, (before, after) = random_round(rng, 2)
            funded, locked_in, locked_out, contested, charges = settle(costs, before, after, abstaining)
            if not contested or not locked_in:
                continue
            extended += 1
            for rule in differs:
                again, _, _ = tally(costs, after, abstaining, rule, locked_in, locked_out, charges)
                differs[rule] += set(again) != set(funded)
        self.assertGreater(differs["reset"], extended // 10)
        self.assertLess(differs["frozen"], extended // 50)

    def test_taking_locked_out_proposals_off_the_ballots_breaks_the_deadline_result(self):
        # A is locked out. One voter ranks A, then B; the other is indifferent. Left in
        # place, A keeps B at the first voter's second rank and C wins the tie-break.
        # Taken off, B moves up to first, gathers both voters and beats C.
        costs = [10, 4, 3]
        voters = [(2, [1, 2, 0]), (4, [1, 1, 1])]
        self.assertEqual(pbear(costs, voters), [2])
        reduced_costs, reduced, keep = remove_projects(costs, voters, {0})
        self.assertEqual([keep[c] for c in pbear(reduced_costs, reduced)], [1])
        # Leaving it on the ballots as a proposal that can never be funded changes nothing.
        self.assertEqual(tally(costs, voters, 0, "replay", locked_out={0})[0], [2])


class ChangedBallots(unittest.TestCase):
    """What survives when ballots do change during an extension."""

    def test_no_rule_can_fund_a_locked_out_proposal_however_much_support_it_gains(self):
        # Nobody had voted for B when it was settled. In the extension every voter
        # ranks it first and could pay for it, and it still cannot be funded: the
        # proportionality axiom fails on the final ballots under every rule.
        costs = [1, 6]
        window = [(5, None), (4, None)]
        deadline = [(5, None), (4, [1, 2])]
        final = [(5, [2, 1]), (4, [1, 1])]
        self.assertEqual(pbear(costs, final), [1, 0])
        for rule in RULES:
            outcome = run_round(costs, [window, deadline, final], rule=rule)
            self.assertEqual(outcome["funded"], [0], rule)
            self.assertFalse(is_ipsc(costs, 9, final, outcome["funded"]), rule)

    def test_replay_is_proportional_among_live_proposals_when_no_reserve_is_needed(self):
        # Replay with locked-out proposals is plain PB-EAR on an instance where those
        # proposals cost more than the budget, unless money had to be held back for a
        # locked-in proposal. Whenever the two agree, the axiom holds on that instance.
        rng = random.Random(5)
        agree = differ = 0
        for _ in range(1500):
            costs, abstaining, (before, after, final) = random_round(rng, 3)
            _, locked_in, locked_out, contested, _ = settle(costs, before, after, abstaining)
            if not contested:
                continue
            budget = sum(w for w, _ in final) + abstaining
            live = [budget + 1 if c in locked_out else cost for c, cost in enumerate(costs)]
            funded, _, _ = tally(costs, final, abstaining, "replay", locked_in, locked_out)
            if funded == pbear(live, final, abstaining):
                agree += 1
                self.assertTrue(is_ipsc(live, budget, final, funded))
            else:
                differ += 1
        self.assertGreater(agree, 400)
        self.assertLess(differ, agree // 10)

    def test_replay_breaks_proportionality_when_money_is_held_for_a_locked_in_proposal(self):
        # C (cost 6) is locked in, A and D are locked out, the budget is 10. On the
        # final ballots one voter funds E, and the other has 4 for B, which costs 3.
        # But 6 must stay reserved for C, so B does not fit, and that voter's weight
        # ends up paying for C instead.
        costs = [5, 3, 6, 2, 3]
        final = [(5, [0, 0, 1, 0, 2]), (4, [1, 2, 0, 0, 0])]
        funded, _, forced = tally(costs, final, 1, "replay", locked_in=[2], locked_out={0, 3})
        self.assertEqual((funded, forced), ([4, 2], []))
        live = [11, 3, 6, 11, 3]
        self.assertFalse(is_ipsc(live, 10, final, funded))

    def test_every_rule_keeps_the_locks_and_the_budget(self):
        rng = random.Random(8)
        extended = 0
        for _ in range(2000):
            costs, abstaining, (before, after, final) = random_round(rng, 3)
            _, locked_in, locked_out, contested, charges = settle(costs, before, after, abstaining)
            if not contested:
                continue
            extended += 1
            budget = sum(w for w, _ in final) + abstaining
            for rule in RULES:
                funded, paid, forced = tally(costs, final, abstaining, rule, locked_in, locked_out, charges)
                self.assertEqual(len(funded), len(set(funded)))
                self.assertLessEqual(set(locked_in), set(funded))
                self.assertFalse(set(funded) & locked_out)
                self.assertLessEqual(sum(costs[c] for c in funded), budget)
                spent_by = [0] * len(final)
                for c, shares in paid.items():
                    total = sum(shares.values())
                    self.assertTrue(total == costs[c] or (c in forced and total < costs[c]))
                    for i, d in shares.items():
                        spent_by[i] += d
                if rule == "frozen":
                    for i, d in charges.items():
                        spent_by[i] += d
                for (w, _), s in zip(final, spent_by):
                    self.assertLessEqual(s, w)
        self.assertGreater(extended, 500)


class Schedule(unittest.TestCase):
    def test_extensions_halve_and_stay_under_twice_the_first(self):
        hours = extension_lengths(48, 1)
        self.assertEqual(hours, [48, 24, 12, 6, 3, 1.5])
        self.assertLess(sum(hours), 2 * 48)

    def test_a_fight_that_never_settles_still_ends(self):
        # Two voters keep swapping which of two proposals they back, forever.
        costs = [3, 3]
        a, b = [(3, [1, 2]), (1, None)], [(3, [2, 1]), (1, None)]
        profiles = [a, b] * 20
        limit = len(extension_lengths(48, 1))
        for rule in RULES:
            outcome = run_round(costs, profiles, rule=rule, max_extensions=limit)
            self.assertEqual(outcome["extensions"], limit, rule)
            self.assertEqual(outcome["contested"][-1], [0, 1], rule)

    def test_the_contested_set_never_grows(self):
        rng = random.Random(13)
        for _ in range(500):
            costs, abstaining, profiles = random_round(rng, 6)
            for rule in RULES:
                history = run_round(costs, profiles, abstaining, rule)["contested"]
                for earlier, later in zip(history, history[1:]):
                    self.assertLessEqual(set(later), set(earlier))


if __name__ == "__main__":
    unittest.main()
