"""Quiet Ending in steps: what PB-EAR keeps and gives up when voters may change their
ballots after each funded proposal. Tests named `..._cannot_...` or `..._lets_...`
document a property that changes; they pass when the change is reproduced.
"""

import itertools
import random
import unittest

from pbear import effective_ranks, is_ipsc, pbear, validate_ballot
from quiet_ending import pin_settled
from quiet_ending_steps import counted_part_kept, rearranged_below, run_in_steps, tier_levels
from test_pbear import random_ballot

A, B, C, D = 0, 1, 2, 3


def strict(order, m):
    ranks = [0] * m
    for position, c in enumerate(order):
        ranks[c] = position + 1
    return ranks


def all_ballots(m):
    for ranks in itertools.product(range(m + 1), repeat=m):
        try:
            validate_ballot(list(ranks), m)
        except ValueError:
            continue
        yield list(ranks)


def random_instance(rng):
    m = rng.randint(2, 5)
    costs = [rng.randint(1, 10) for _ in range(m)]
    voters = [
        (rng.randint(1, 10), None if rng.random() < 0.15 else random_ballot(rng, m)) for _ in range(rng.randint(2, 5))
    ]
    return costs, voters, rng.randint(0, 3)


def random_revisions(rng, m, history):
    """A `revise` that redraws about half of the ballots at every pause and records the
    ballots each step was tallied with in `history`."""

    def revise(state):
        ballots = [b if rng.random() < 0.5 else random_ballot(rng, m) for b in state["ballots"]]
        history.append(ballots)
        return ballots

    return revise


class SameAlgorithm(unittest.TestCase):
    def test_without_revisions_it_is_plain_pbear(self):
        rng = random.Random(1)
        for _ in range(500):
            costs, voters, abstaining = random_instance(rng)
            expected = pbear(costs, voters, abstaining)
            self.assertEqual(run_in_steps(costs, voters, abstaining)["funded"], expected)
            unchanged = run_in_steps(costs, voters, abstaining, revise=lambda state: state["ballots"])
            self.assertEqual(unchanged["funded"], expected)

    def test_it_pauses_once_per_funded_proposal_and_not_after_the_last(self):
        costs = [3, 3, 3]
        voters = [(3, strict([A, B, C], 3)), (3, strict([B, A, C], 3))]
        pauses = []
        result = run_in_steps(costs, voters, revise=lambda state: pauses.append(state["funded"]))
        self.assertEqual(result["funded"], [A, B])
        self.assertEqual(pauses, [[A]])


class UsedVotes(unittest.TestCase):
    """The two groups of `test_quiet_ending`: a majority of 60 that likes X (40) and Y
    (50) equally and a minority of 40 that only wants Z (40)."""

    costs = [40, 50, 40]
    minority = [0, 0, 1]

    def test_spent_weight_cannot_be_used_again_whatever_the_majority_submits(self):
        # X is funded first and costs the majority 40 of its 60. Whatever ballot it
        # switches to at the pause, it has 20 left: Z is funded for the minority and Y
        # never is.
        for ballot in all_ballots(3):
            result = run_in_steps(
                self.costs,
                [(60, [1, 1, 3]), (40, self.minority)],
                revise=lambda state: [ballot, self.minority] if state["funded"] == [0] else None,
            )
            self.assertEqual(set(result["funded"]), {0, 2}, ballot)
            self.assertEqual(result["paid"][0], {0: 40})

    def test_a_holder_without_a_ballot_can_join_at_a_pause_with_its_own_weight(self):
        costs = [3, 3]
        voters = [(3, strict([A, B], 2)), (3, None)]
        self.assertEqual(pbear(costs, voters), [A])
        result = run_in_steps(costs, voters, revise=lambda state: [state["ballots"][0], strict([B, A], 2)])
        self.assertEqual(result["funded"], [A, B])
        self.assertEqual(result["paid"][B], {1: 3})
        self.assertEqual(result["budget"], 6)


class AlwaysTrue(unittest.TestCase):
    """Properties that hold however the ballots are revised."""

    def test_money_and_weight_are_accounted_for_at_every_step(self):
        rng = random.Random(2)
        for _ in range(1500):
            costs, voters, abstaining = random_instance(rng)
            m = len(costs)
            history = [[b for _, b in voters]]
            result = run_in_steps(costs, voters, abstaining, random_revisions(rng, m, history))
            budget = sum(w for w, _ in voters) + abstaining
            spent_by = [0] * len(voters)
            seen = set()
            for step, (c, level, shares) in enumerate(result["steps"]):
                self.assertNotIn(c, seen)
                seen.add(c)
                self.assertEqual(sum(shares.values()), costs[c])
                for i, d in shares.items():
                    # Every payer approved the proposal on the ballot it had then.
                    self.assertLessEqual(effective_ranks(history[step][i])[c], level)
                    spent_by[i] += d
            self.assertLessEqual(result["spent"], budget)
            for (w, _), spent, left in zip(voters, spent_by, result["weights"]):
                self.assertEqual(w - spent, left)
                self.assertGreaterEqual(left, 0)

    def test_what_is_left_cannot_pay_for_any_unfunded_proposal(self):
        # Even if every voter agreed on it: the unspent weight of all the voters with a
        # ballot is less than the cost of each proposal left unfunded.
        rng = random.Random(3)
        for _ in range(1500):
            costs, voters, abstaining = random_instance(rng)
            result = run_in_steps(costs, voters, abstaining, random_revisions(rng, len(costs), []))
            left = sum(w for w, b in zip(result["weights"], result["ballots"]) if b is not None)
            for c in range(len(costs)):
                if c not in result["funded"]:
                    self.assertLess(left, costs[c])


class WhatChanges(unittest.TestCase):
    def test_a_voter_who_has_paid_cannot_claim_again_by_changing_its_ballot(self):
        # The voter is indifferent, so the cheaper B is funded with 5 of its 7. It then
        # says it wanted A all along. On the final ballots it is a group of weight 7
        # asking for a proposal that costs 7, which a fresh tally would fund, and the
        # proportionality axiom fails: the axiom does not know that 5 of the 7 are gone.
        costs = [7, 5]
        voters = [(7, [0, 0]), (6, None)]
        result = run_in_steps(costs, voters, 2, revise=lambda state: [[1, 0], None])
        self.assertEqual(result["funded"], [B])
        final = [(7, [1, 0]), (6, None)]
        self.assertFalse(is_ipsc(costs, 15, final, result["funded"]))
        self.assertEqual(pbear(costs, final, 2), [A])

    def test_proportionality_on_the_final_ballots_fails_only_when_ballots_were_revised(self):
        rng = random.Random(4)
        revised = failed = 0
        for _ in range(3000):
            costs, voters, abstaining = random_instance(rng)
            budget = sum(w for w, _ in voters) + abstaining
            result = run_in_steps(costs, voters, abstaining, random_revisions(rng, len(costs), []))
            final = [(w, b) for (w, _), b in zip(voters, result["ballots"])]
            holds = is_ipsc(costs, budget, final, result["funded"])
            if final == voters:
                self.assertTrue(holds)
            else:
                revised += 1
                failed += not holds
        self.assertGreater(failed, revised // 50)
        self.assertLess(failed, revised // 5)

    def test_revising_between_steps_lets_a_voter_jump_the_queue(self):
        # A and D cost 2, B 4, C 6; three voters with 4 each. Plain PB-EAR funds A and
        # D on first choices, then B at the second rank level, where it beats C on cost.
        # If the first voter moves C to the top once A is funded, C is counted at the
        # first level, before anybody's second choice, and is funded instead of B.
        costs = [2, 4, 6, 2]
        orders = [[A, C, B, D], [C, B, D, A], [D, B, A, C]]
        voters = [(4, strict(order, 4)) for order in orders]
        self.assertEqual(pbear(costs, voters), [A, D, B])

        def promote(state):
            ballots = state["ballots"]
            if state["funded"] == [A]:
                ballots[0] = strict([C, B, D, A], 4)
            return ballots

        result = run_in_steps(costs, voters, revise=promote)
        self.assertEqual(result["funded"], [A, C, D])
        self.assertEqual(result["steps"][1], (C, 1, {0: 2, 1: 4}))


class TierPauses(unittest.TestCase):
    """Pausing once per tier instead of once per funded proposal."""

    # Five proposals. Tiers of the short ballot: [A] [B] [C]. Of the long one: [B, C, D] [A].
    short = [1, 2, 3, 0, 0]
    long = [4, 1, 1, 1, 0]

    def test_a_tier_is_counted_for_everyone_at_the_highest_rank_any_voter_gives_it(self):
        self.assertEqual(tier_levels([self.short, self.long, None], 3), [1, 4, 3])
        self.assertEqual(tier_levels([None], 2), [None, None])

    def test_the_first_pause_is_when_first_tiers_can_fund_nothing_more(self):
        rng = random.Random(5)
        seen = 0
        for _ in range(800):
            costs, voters, abstaining = random_instance(rng)
            snapshots = []
            result = run_in_steps(costs, voters, abstaining, revise=snapshots.append, tiers=1)
            if not snapshots:
                continue
            seen += 1
            first = snapshots[0]
            self.assertEqual(len(snapshots), 1)
            self.assertEqual(first["level"], 1)
            self.assertEqual(result["pauses"][0]["funded"], len(first["funded"]))
            self.assertTrue(all(level == 1 for _, level, _ in first["steps"]))
            for c in range(len(costs)):
                if c in first["funded"]:
                    continue
                top = sum(w for w, b in zip(first["weights"], first["ballots"]) if b and effective_ranks(b)[c] == 1)
                self.assertLess(top, costs[c])
        self.assertGreater(seen, 300)

    def test_a_later_pause_waits_for_the_longest_first_tier(self):
        # The long ballot's second tier has rank 4, so the second pause comes at level
        # 4. The short ballot's second and third tiers (ranks 2 and 3) are both counted
        # by then, so there is no third pause.
        costs = [9, 9, 9, 30, 30]
        voters = [(20, self.short), (20, self.long)]
        result = run_in_steps(costs, voters, 30, revise=lambda state: None, tiers=3)
        self.assertEqual([p["level"] for p in result["pauses"]], [1, 4])
        self.assertEqual([p["funded"] for p in result["pauses"]], [3, 3])
        self.assertEqual(result["funded"], pbear(costs, voters, 30))

    def test_there_is_at_most_one_pause_per_tier_and_the_accounts_balance(self):
        rng = random.Random(6)
        for _ in range(1500):
            costs, voters, abstaining = random_instance(rng)
            tiers = rng.randint(1, 3)
            result = run_in_steps(costs, voters, abstaining, random_revisions(rng, len(costs), []), tiers)
            self.assertLessEqual(len(result["pauses"]), tiers)
            levels = [p["level"] for p in result["pauses"]]
            self.assertEqual(levels, sorted(set(levels)))
            paid = [0] * len(voters)
            for c, _, shares in result["steps"]:
                self.assertEqual(sum(shares.values()), costs[c])
                for i, d in shares.items():
                    paid[i] += d
            for (w, _), spent, left in zip(voters, paid, result["weights"]):
                self.assertEqual(w - spent, left)
                self.assertGreaterEqual(left, 0)
            left = sum(w for w, b in zip(result["weights"], result["ballots"]) if b is not None)
            self.assertTrue(all(left < costs[c] for c in range(len(costs)) if c not in result["funded"]))

    def test_without_revisions_it_is_plain_pbear(self):
        rng = random.Random(7)
        for _ in range(500):
            costs, voters, abstaining = random_instance(rng)
            result = run_in_steps(costs, voters, abstaining, revise=lambda state: None, tiers=3)
            self.assertEqual(result["funded"], pbear(costs, voters, abstaining))


def tiers_of(ballot):
    groups = {}
    for c, r in enumerate(ballot):
        if r:
            groups.setdefault(r, []).append(c)
    return [groups[r] for r in sorted(groups)]


class RevisionRules(unittest.TestCase):
    """What a voter may change at a tier pause, from loosest to strictest: anything;
    anything except taking funded proposals off the ballot; only the part of the ballot
    the tally has not counted yet."""

    def revise(self, rng, m, rule):
        def revise(state):
            out = []
            for old in state["ballots"]:
                new = old if rng.random() < 0.5 else random_ballot(rng, m)
                if rule == "funded stay":
                    new = pin_settled(old, new, set(state["funded"]))
                elif rule == "counted part stays":
                    new = rearranged_below(old, state["level"], tiers_of(new))
                    self.assertTrue(counted_part_kept(old, new, state["level"]))
                out.append(new)
            return out

        return revise

    def outcomes(self, rule, rounds=2500):
        """How many revised rounds fail the proportionality axiom on the final ballots,
        and how many end away from the plain tally of the final ballots."""
        rng = random.Random(9)
        revised = unproportional = not_plain = 0
        for _ in range(rounds):
            m = rng.randint(2, 5)
            costs = [rng.randint(1, 10) for _ in range(m)]
            voters = [(rng.randint(1, 10), random_ballot(rng, m)) for _ in range(rng.randint(2, 5))]
            abstaining = rng.randint(0, 3)
            result = run_in_steps(costs, voters, abstaining, self.revise(rng, m, rule), tiers=3)
            final = [(w, b) for (w, _), b in zip(voters, result["ballots"])]
            if final == voters:
                continue
            revised += 1
            budget = sum(w for w, _ in voters) + abstaining
            unproportional += not is_ipsc(costs, budget, final, result["funded"])
            not_plain += result["funded"] != pbear(costs, final, abstaining)
        return revised, unproportional, not_plain

    def test_keeping_funded_proposals_on_the_ballot_cannot_stop_a_second_claim(self):
        # The big voter is indifferent and pays 6 of the 8 for A. At the pause it puts
        # B on top. A never left its ballot, but the ballot now says B came first, and
        # on the final ballots this voter of weight 9 is owed B, which costs 7.
        costs = [8, 7]
        voters = [(3, [1, 2]), (9, [0, 0])]
        before = voters[1][1]
        after = pin_settled(before, [0, 1], {A})
        self.assertEqual(after, [0, 1])
        result = run_in_steps(costs, voters, 3, revise=lambda state: [voters[0][1], after], tiers=3)
        self.assertEqual(result["funded"], [A])
        self.assertEqual(result["paid"][A], {0: 2, 1: 6})
        self.assertFalse(is_ipsc(costs, 15, [voters[0], (9, after)], result["funded"]))

    def test_keeping_funded_proposals_helps_but_does_not_restore_proportionality(self):
        revised, loose, _ = self.outcomes("anything")
        revised_pinned, pinned, not_plain = self.outcomes("funded stay")
        self.assertGreater(pinned, 0)
        self.assertLess(pinned / revised_pinned, loose / revised)
        self.assertGreater(not_plain, revised_pinned // 5)

    def test_keeping_the_counted_part_gives_the_plain_tally_of_the_final_ballots(self):
        # PB-EAR at level j only looks at ranks up to j. If nothing within the levels
        # already counted may change, every level was counted on the final ballots, so
        # the result is the plain tally of them, with all of its guarantees.
        revised, unproportional, not_plain = self.outcomes("counted part stays")
        self.assertGreater(revised, 800)
        self.assertEqual((unproportional, not_plain), (0, 0))

    def test_pausing_after_every_proposal_changes_nothing_until_the_level_moves(self):
        # With the counted part kept, a pause after each funded proposal is still the
        # plain tally of the final ballots. But a revision made while the tally is at
        # level j cannot touch ranks up to j, which is all level j looks at: everything
        # else funded at that level was already decided. Revisions only reach the
        # proposals funded after the level has moved on.
        rng = random.Random(10)
        revised = later_changed = 0
        for _ in range(2500):
            m = rng.randint(2, 5)
            costs = [rng.randint(1, 10) for _ in range(m)]
            voters = [(rng.randint(1, 10), random_ballot(rng, m)) for _ in range(rng.randint(2, 5))]
            abstaining = rng.randint(0, 3)
            plain = run_in_steps(costs, voters, abstaining)
            result = run_in_steps(costs, voters, abstaining, self.revise(rng, m, "counted part stays"))
            final = [(w, b) for (w, _), b in zip(voters, result["ballots"])]
            if final == voters:
                continue
            revised += 1
            self.assertEqual(result["funded"], pbear(costs, final, abstaining))
            first_level = [step for step in plain["steps"] if step[1] == plain["steps"][0][1]]
            self.assertEqual(result["steps"][: len(first_level)], first_level)
            later_changed += result["funded"] != plain["funded"]
        self.assertGreater(revised, 800)
        self.assertGreater(later_changed, revised // 20)

    def test_the_counted_part_is_everything_within_the_level(self):
        old = [1, 2, 2, 4, 0]  # tiers [A] [B, C] [D], E unplaced at rank 5
        self.assertTrue(counted_part_kept(old, [1, 2, 2, 0, 4], 3))  # D and E swap below level 3
        self.assertFalse(counted_part_kept(old, [1, 2, 3, 4, 0], 3))  # C moved inside the counted part
        self.assertFalse(counted_part_kept(old, [1, 2, 2, 2, 0], 3))  # D promoted into it
        self.assertTrue(counted_part_kept(None, [1, 2, 2, 4, 0], 3))
        self.assertFalse(counted_part_kept(old, None, 1))

    def test_rearranging_below_the_level_keeps_the_counted_part(self):
        old = [1, 2, 2, 4, 0]
        self.assertEqual(rearranged_below(old, 3, [[4], [3]]), [1, 2, 2, 5, 4])
        self.assertEqual(rearranged_below(old, 3, [[4]]), [1, 2, 2, 0, 4])
        self.assertEqual(rearranged_below(old, 3, [[0, 4], [1]]), [1, 2, 2, 0, 4])
        # Once the unplaced tier has been counted, the whole ballot has.
        self.assertEqual(rearranged_below(old, 5, [[4], [3]]), old)


if __name__ == "__main__":
    unittest.main()
