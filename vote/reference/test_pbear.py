"""Tests for the PB-EAR reference implementation.

Fixtures come from Aziz & Lee, "Proportionally Representative Participatory
Budgeting with Ordinal Preferences" (AAAI-21), Examples 1-5.

Ballot encoding: list of ints, one per project, value = 1 + number of projects the
voter strictly prefers (ties share a value), 0 = unranked (last tier).
"""

import json
import os
import random
import subprocess
import sys
import unittest

from pbear import (
    NONE,
    abi_encode_uint_array,
    cumulative_deductions,
    effective_ranks,
    is_exhaustive,
    is_ipsc,
    pbear,
    pbear_transcript,
    replay_public,
    validate_ballot,
)


def strict(order, m):
    """Build a ballot from a strict order given as project indices."""
    ranks = [0] * m
    for pos, c in enumerate(order):
        ranks[c] = pos + 1
    return ranks


A, B, C, D = 0, 1, 2, 3


def merged(voters):
    """Merge voters with identical ballots into one weighted voter.

    Sound for IPSC checks: any coalition mixing partial groups is dominated by
    the union of the full groups it touches, which has at least as much weight.
    """
    groups = {}
    for w, ballot in voters:
        key = tuple(ballot)
        groups[key] = groups.get(key, 0) + w
    return [(w, list(key)) for key, w in groups.items()]


class ExampleFixtures(unittest.TestCase):
    def test_example1_selects_a_and_b(self):
        # 9 voters, 4 equal-cost projects, room for exactly 3 of them.
        # Budget equals total weight (9), so each project costs 3.
        costs = [3, 3, 3, 3]
        voters = [(1, strict([A, B, C, D], 4))] * 6
        voters += [(1, strict([D, C, B, A], 4))] * 2
        voters += [(1, strict([C, A, B, D], 4))]
        funded = pbear(costs, voters)
        self.assertIn(A, funded)
        self.assertIn(B, funded)
        self.assertEqual(len(funded), 3)

    def test_example2(self):
        # 30 voters a>b>c>d, 70 voters d>c>b>a; costs a50 b30 c30 d40; L=100.
        costs = [50, 30, 30, 40]
        voters = [(1, strict([A, B, C, D], 4))] * 30
        voters += [(1, strict([D, C, B, A], 4))] * 70
        funded = pbear(costs, voters)
        # Level 1: d has 70 >= 40 -> fund d, the 70 voters keep 30.
        # Level 2: b has 30 >= 30 (first group), c has 30 >= 30 (second group);
        #          tie on support and cost -> lower id b first, then c.
        self.assertEqual(funded, [D, B, C])

    def test_example3_ties_in_first_group(self):
        # first group: a > b ~ c > d
        costs = [50, 30, 30, 40]
        voters = [(1, [1, 2, 2, 4])] * 30
        voters += [(1, strict([D, C, B, A], 4))] * 70
        funded = pbear(costs, voters)
        # Level 1: d funded (70 -> 30 left).
        # Level 2: group1 approves {a,b,c}, group2 {d,c}: c has 60, b 30, a 30.
        #          c funded; supporters keep 30 in total (15 per group).
        # Level 3: group2 now approves b too: b has 15+15 = 30 -> funded.
        self.assertEqual(funded, [D, C, B])

    def test_example4_split_first_group(self):
        costs = [50, 30, 30, 40]
        voters = [(1, strict([A, B, C, D], 4))] * 15
        voters += [(1, strict([B, A, C, D], 4))] * 15
        voters += [(1, strict([D, C, B, A], 4))] * 70
        funded = pbear(costs, voters)
        self.assertEqual(funded, [D, B, C])

    def test_example5_combined_groups(self):
        costs = [90, 30, 80, 40]
        voters = [(1, strict([A, B, C, D], 4))] * 14
        voters += [(1, strict([A, C, B, D], 4))] * 16
        voters += [(1, strict([C, A, B, D], 4))] * 70
        funded = pbear(costs, voters)
        # Level 1: c has 70 < 80, a has 30 < 90 -> advance.
        # Level 2: a is approved by everyone (100 >= 90), c by 86 (>= 80).
        #          Highest support wins: a. Remaining 10 affords nothing.
        self.assertEqual(funded, [A])
        self.assertTrue(is_ipsc(costs, 100, merged(voters), funded))


class Validation(unittest.TestCase):
    def test_valid_ballots(self):
        for ranks in ([1, 2, 2, 4], [0, 0, 0], [2, 2, 1], [1, 0, 0], [1, 2, 3]):
            validate_ballot(ranks, len(ranks))

    def test_invalid_ballots(self):
        for ranks, m in (([1, 3, 3], 3), ([1, 2], 3), ([4, 1, 2], 3), ([2, 2, 2], 3)):
            with self.assertRaises(ValueError):
                validate_ballot(ranks, m)

    def test_effective_ranks_fill_last_tier(self):
        self.assertEqual(effective_ranks([2, 0, 1, 0]), [2, 3, 1, 3])
        self.assertEqual(effective_ranks([0, 0]), [1, 1])


class Reweighting(unittest.TestCase):
    def test_cumulative_deductions_are_exact(self):
        rng = random.Random(1)
        for _ in range(200):
            weights = [rng.randint(1, 50) for _ in range(rng.randint(1, 8))]
            total = sum(weights)
            thr = rng.randint(0, total)
            deductions = cumulative_deductions(weights, thr)
            self.assertEqual(sum(deductions), thr)
            for w, d in zip(weights, deductions):
                self.assertTrue(0 <= d <= w)


def random_ballot(rng, m):
    order = list(range(m))
    rng.shuffle(order)
    kept = rng.randint(0, m)
    ranks = [0] * m
    rank = 1
    for pos, c in enumerate(order[:kept]):
        if pos > 0 and rng.random() < 0.4:
            pass  # tie with previous
        else:
            rank = pos + 1
        ranks[c] = rank
    return ranks


def random_voters_instance(rng, all_vote=True):
    n = rng.randint(1, 6)
    m = rng.randint(1, 5)
    costs = [rng.randint(1, 10) for _ in range(m)]
    voters = []
    for _ in range(n):
        w = rng.randint(1, 10)
        if all_vote or rng.random() < 0.7:
            voters.append((w, random_ballot(rng, m)))
        else:
            voters.append((w, None))
    abstaining = 0 if all_vote else rng.randint(0, 10)
    return costs, voters, abstaining


class Properties(unittest.TestCase):
    def test_outcome_is_exhaustive_when_everyone_votes(self):
        rng = random.Random(7)
        for _ in range(300):
            costs, voters, abstaining = random_voters_instance(rng, all_vote=True)
            funded = pbear(costs, voters, abstaining)
            budget = sum(w for w, _ in voters) + abstaining
            self.assertTrue(is_exhaustive(costs, budget, funded), (costs, voters, funded))

    def test_outcome_satisfies_ipsc(self):
        rng = random.Random(11)
        for _ in range(300):
            for all_vote in (True, False):
                costs, voters, abstaining = random_voters_instance(rng, all_vote)
                funded = pbear(costs, voters, abstaining)
                budget = sum(w for w, _ in voters) + abstaining
                self.assertTrue(is_ipsc(costs, budget, voters, funded), (costs, voters, abstaining, funded))

    def test_ipsc_rejects_unrepresentative_outcome(self):
        # Two voters, each with weight 5 and their own favourite costing 5.
        # Funding only voter 0's favourite twice-over is impossible, so fund a
        # project nobody ranks first instead.
        costs = [5, 5]
        voters = [(5, [1, 2]), (5, [2, 1])]
        self.assertFalse(is_ipsc(costs, 10, voters, [0]))
        self.assertTrue(is_ipsc(costs, 10, voters, [0, 1]))

    def test_spent_never_exceeds_budget(self):
        rng = random.Random(3)
        for _ in range(300):
            costs, voters, abstaining = random_voters_instance(rng, all_vote=False)
            funded = pbear(costs, voters, abstaining)
            budget = sum(w for w, _ in voters) + abstaining
            self.assertLessEqual(sum(costs[c] for c in funded), budget)


class AbiEncoding(unittest.TestCase):
    def test_encodes_uint256_array(self):
        self.assertEqual(
            abi_encode_uint_array([]),
            "0x" + "20".rjust(64, "0") + "0" * 64,
        )
        self.assertEqual(
            abi_encode_uint_array([3]),
            "0x" + "20".rjust(64, "0") + "1".rjust(64, "0") + "3".rjust(64, "0"),
        )


def random_instance(rng, n_pub, n_sealed, m):
    costs = [rng.randint(1, 10) for _ in range(m)]

    def entry():
        w = rng.randint(0, 10)
        if rng.random() < 0.2:
            return (w, None)
        order = list(range(m))
        rng.shuffle(order)
        kept = rng.randint(0, m)
        ranks = [0] * m
        rank = 1
        for pos in range(kept):
            if pos == 0 or rng.random() < 0.6:
                rank = pos + 1
            ranks[order[pos]] = rank
        return (w, ranks)

    public = [entry() for _ in range(n_pub)]
    sealed = [entry() for _ in range(n_sealed)]
    budget = sum(w for w, _ in public + sealed) + rng.randint(0, 10)
    return costs, public, sealed, budget


class TranscriptTest(unittest.TestCase):
    def test_matches_single_list_tally(self):
        rng = random.Random(7)
        for _ in range(300):
            m = rng.randint(1, 5)
            costs, public, sealed, budget = random_instance(rng, rng.randint(0, 4), rng.randint(0, 4), m)
            abstaining = budget - sum(w for w, _ in public + sealed)
            expected = pbear(costs, public + sealed, abstaining)
            funded, transcript = pbear_transcript(costs, public, sealed, budget)
            self.assertEqual(funded, expected)
            self.assertEqual([s[m + 1] for s in transcript if s[m + 1] != NONE], funded)

    def test_transcript_never_exceeds_two_m_steps(self):
        # Each project can be funded once, and there are at most m rank advances.
        rng = random.Random(23)
        for _ in range(300):
            m = rng.randint(1, 5)
            costs, public, sealed, budget = random_instance(rng, rng.randint(0, 4), rng.randint(0, 4), m)
            _, transcript = pbear_transcript(costs, public, sealed, budget)
            self.assertLessEqual(len(transcript), 2 * m, (costs, public, sealed, budget))

    def test_step_shape_and_levels(self):
        costs = [30, 70]
        public = [(40, [1, 2])]
        sealed = [(60, [2, 1])]
        funded, transcript = pbear_transcript(costs, public, sealed, 100)
        # Level 1: A (id 0) funded with public 40 + sealed 0 = 40 ≥ 30.
        # Level 1 again: the public voter ranks B second, so public support for B is
        # still 0; sealed 60 < 70 → NONE, level advances.
        # Level 2: B has public 10 (40 − 30) + sealed 60 = 70 → funded.
        self.assertEqual(funded, [0, 1])
        self.assertEqual(transcript[0], [1, 40, 0, 0, 40])
        self.assertEqual(transcript[1], [1, 0, 0, NONE, 0])
        self.assertEqual(transcript[2], [2, 0, 10, 1, 70])

    def test_terminal_none_step_recorded(self):
        # Nothing affordable by support at any level: the last step is NONE at level >= m.
        costs = [100]
        funded, transcript = pbear_transcript(costs, [(10, [1])], [(10, [1])], 100)
        self.assertEqual(funded, [])
        self.assertEqual(transcript, [[1, 10, NONE, 0]])

    def test_exhausted_at_start_has_no_steps(self):
        funded, transcript = pbear_transcript([50], [(10, [1])], [], 10)
        self.assertEqual((funded, transcript), ([], []))

    def test_public_replay_accepts_and_rejects(self):
        rng = random.Random(11)
        for _ in range(100):
            m = rng.randint(1, 4)
            costs, public, sealed, budget = random_instance(rng, rng.randint(1, 4), rng.randint(0, 3), m)
            _, transcript = pbear_transcript(costs, public, sealed, budget)
            self.assertTrue(replay_public(costs, public, transcript, budget))
            if transcript:
                tampered = [list(s) for s in transcript]
                tampered[0][1] += 1  # first public support entry
                self.assertFalse(replay_public(costs, public, tampered, budget))

    def test_public_replay_rejects_double_funding(self):
        costs = [30, 70]
        _, transcript = pbear_transcript(costs, [(40, [1, 2])], [(60, [2, 1])], 100)
        tampered = [list(s) for s in transcript]
        tampered[2][3] = 0  # fund project 0 twice
        self.assertFalse(replay_public(costs, [(40, [1, 2])], tampered, 100))

    def test_cli_transcript_mode(self):
        payload = {"costs": [30, 70], "public": [[40, [1, 2]]], "sealed": [[60, [2, 1]]], "budget": 100}
        out = subprocess.run(
            [sys.executable, "pbear.py", "--transcript", json.dumps(payload)],
            capture_output=True, text=True, check=True, cwd=os.path.dirname(os.path.abspath(__file__)),
        ).stdout
        result = json.loads(out)
        self.assertEqual(result["funded"], [0, 1])
        self.assertEqual(len(result["transcript"]), 3)


if __name__ == "__main__":
    unittest.main()
