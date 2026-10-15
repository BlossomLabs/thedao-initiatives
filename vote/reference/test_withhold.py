"""Withholding: unplaced proposals a voter marks get none of that voter's money, and
the tally is still PB-EAR on a longer ballot (see `withhold`)."""

import random
import unittest

from pbear import is_ipsc, pbear
from test_pbear import random_ballot
from withhold import WITHHELD, pbear_withhold, reference_tally, reference_transcript, withhold_all

A, B, C = 0, 1, 2
W = WITHHELD


def random_round(rng, withholding=0.5):
    m = rng.randint(2, 5)
    costs = [rng.randint(1, 10) for _ in range(m)]
    voters = []
    for _ in range(rng.randint(1, 5)):
        ballot = None if rng.random() < 0.1 else random_ballot(rng, m)
        if ballot is not None:
            ballot = [W if r == 0 and rng.random() < withholding else r for r in ballot]
        voters.append((rng.randint(1, 10), ballot))
    return costs, voters, rng.randint(0, 3)


class Examples(unittest.TestCase):
    def test_leftover_money_funds_an_unplaced_proposal_unless_it_is_withheld(self):
        # Both holders want A, which costs 4 of their 10. B costs 6 and neither placed
        # it. Today their leftover funds it; if one of them withholds, it cannot.
        costs = [4, 6]
        self.assertEqual(pbear(costs, [(5, [1, 0]), (5, [1, 0])]), [A, B])
        funded, paid, left = pbear_withhold(costs, [(5, [1, 0]), (5, [1, W])])
        self.assertEqual((funded, left), ([A], [3, 3]))

    def test_withholding_is_not_a_veto(self):
        # The first holder withholds B; the second can afford it alone and gets it.
        funded, paid, left = pbear_withhold([4, 6], [(5, [1, W]), (9, [1, 2])])
        self.assertEqual(funded, [A, B])
        self.assertNotIn(0, paid[B])

    def test_a_short_ballot_keeps_its_money_for_what_it_placed(self):
        # A and B cost 3, C costs 2. The first holder placed only A. B is funded first
        # by the other two. At the next level A and C have the same support, the first
        # holder's unplaced tier counting for C, and the cheaper one wins: the first
        # holder pays half of C, which it never placed, and A can no longer be
        # afforded. Withholding B and C keeps that money for A.
        costs = [3, 3, 2]
        others = [(3, [2, 1, 2]), (2, [3, 1, 1])]
        self.assertEqual(pbear(costs, [(2, [1, 0, 0])] + others), [B, C])
        funded, paid, left = pbear_withhold(costs, [(2, [1, W, W])] + others)
        self.assertEqual(funded, [B, A])
        self.assertEqual(paid[A], {0: 1, 1: 2})


class Properties(unittest.TestCase):
    def test_withholding_nothing_is_plain_pbear(self):
        rng = random.Random(1)
        for _ in range(3000):
            costs, voters, abstaining = random_round(rng, withholding=0)
            self.assertEqual(pbear_withhold(costs, voters, abstaining)[0], pbear(costs, voters, abstaining))

    def test_nobody_pays_for_a_proposal_they_withheld_and_the_accounts_balance(self):
        rng = random.Random(2)
        for _ in range(3000):
            costs, voters, abstaining = random_round(rng)
            funded, paid, left = pbear_withhold(costs, voters, abstaining)
            spent = [0] * len(voters)
            for c in funded:
                self.assertEqual(sum(paid[c].values()), costs[c])
                for i, d in paid[c].items():
                    self.assertNotEqual(voters[i][1][c], W)
                    spent[i] += d
            for (w, _), s, rest in zip(voters, spent, left):
                self.assertEqual(w - s, rest)
                self.assertGreaterEqual(rest, 0)

    def test_withholding_everything_unplaced_spends_money_only_on_placed_proposals(self):
        rng = random.Random(3)
        for _ in range(3000):
            costs, voters, abstaining = random_round(rng, withholding=0)
            voters = [(w, None if b is None else withhold_all(b)) for w, b in voters]
            funded, paid, left = pbear_withhold(costs, voters, abstaining)
            for c in funded:
                for i in paid[c]:
                    self.assertNotEqual(voters[i][1][c], W)

    def test_it_is_plain_pbear_on_the_padded_ballots(self):
        # `reference_tally` runs `pbear.py` on the padded ballots and checks that it
        # funds the same proposals in the same order, no dummy, and Return last. The
        # direct tally agrees with it, and the padded outcome is proportional (IPSC).
        rng = random.Random(4)
        returned = 0
        for _ in range(4000):
            costs, voters, abstaining = random_round(rng)
            funded, paid, left = pbear_withhold(costs, voters, abstaining)
            reference, (long_costs, long_voters, outcome) = reference_tally(costs, voters, abstaining)
            self.assertEqual(funded, reference)
            back = sum(w for w, (_, b) in zip(left, voters) if b is not None)
            self.assertEqual(long_costs[-1], back)
            returned += bool(back)
            budget = sum(w for w, _ in voters) + abstaining
            if not abstaining and all(b is not None for _, b in voters):
                self.assertTrue(is_ipsc(long_costs, budget, long_voters, outcome))
        self.assertGreater(returned, 2000)

    def test_the_reference_transcript_is_plain_pbears_when_nothing_is_withheld(self):
        from pbear import pbear_transcript

        rng = random.Random(5)
        for _ in range(2000):
            costs, voters, abstaining = random_round(rng, withholding=0)
            budget = sum(w for w, _ in voters) + abstaining
            cut = rng.randint(0, len(voters))
            self.assertEqual(
                reference_transcript(costs, voters[:cut], voters[cut:], budget),
                pbear_transcript(costs, voters[:cut], voters[cut:], budget),
            )


if __name__ == "__main__":
    unittest.main()
