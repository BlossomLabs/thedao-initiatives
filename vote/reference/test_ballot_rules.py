"""The ballot rules (ballot_rules.py), the same cases as shared/vote/rules.test.ts."""

import unittest

from ballot_rules import check_ballot, check_proof, tiers_of

W = 255


def round_(pool=200, tiers=1):
    projects = [
        {"askUsd": ask, "rfp": i == 5, "groups": [0] if i < 2 else []}
        for i, ask in enumerate([100, 100, 100, 100, 50, 50])
    ]
    return projects, pool, tiers


def ballot(S=(), A=(), B=(), n=6):
    out = [W] * n
    rank = 1
    for group in (S, A, B):
        for i in group:
            out[i] = rank
        rank += len(group)
    return out


def check(b, pool=200, tiers=1):
    projects, pool, tiers = round_(pool, tiers)
    return check_ballot(b, projects, pool, tiers)


class BallotRules(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(check(ballot(S=[0, 2, 3])), {"ok": True, "errors": [], "proof": [0, 2, 3]})

    def test_related_count_as_one(self):
        r = check(ballot(S=[0, 1, 2], B=[3, 4]))
        self.assertEqual(
            r["errors"],
            [
                {"rule": "independent", "tier": 0, "count": 2, "related": [{"group": 0, "projects": [0, 1]}]},
                {"rule": "group", "tier": 0, "group": 0, "groupUsd": 200, "tierUsd": 300},
            ],
        )
        self.assertEqual(r["proof"], [])

    def test_rfp_is_independent(self):
        self.assertTrue(check(ballot(S=[0, 2, 5], B=[3]))["ok"])

    def test_exactly_half(self):
        self.assertEqual(check(ballot(S=[0, 1, 2, 3])), {"ok": True, "errors": [], "proof": [0, 2, 3]})
        self.assertEqual(
            check(ballot(S=[0, 1, 2, 5]))["errors"],
            [{"rule": "group", "tier": 0, "group": 0, "groupUsd": 200, "tierUsd": 350}],
        )

    def test_minimum_size(self):
        self.assertTrue(check(ballot(S=[0, 2, 3]))["ok"])
        self.assertEqual(
            check(ballot(S=[0, 2, 3]), pool=201)["errors"],
            [{"rule": "size", "requested": 300, "needed": 302, "pool": 201}],
        )

    def test_too_many_tiers(self):
        self.assertIn({"rule": "tiers"}, check([1, 2, 3, 4, W, W])["errors"])

    def test_tier_a_when_enforced(self):
        b = ballot(S=[0, 2, 3])
        self.assertTrue(check(b, tiers=1)["ok"])
        self.assertEqual(
            check(b, tiers=3)["errors"], [{"rule": "independent", "tier": 1, "count": 0, "related": []}]
        )

    def test_short_ballot(self):
        self.assertEqual(check([1, 4, 1, 1]), check([1, 4, 1, 1, W, W]))
        self.assertTrue(check([1, 4, 1, 1])["ok"])

    def test_shape(self):
        self.assertEqual(check([1, 1, 1, W, W, W, W])["errors"], [{"rule": "shape"}])
        self.assertEqual(check([1, 4, 1, W, W, W])["errors"], [{"rule": "shape"}])

    def test_check_proof(self):
        projects, pool, tiers = round_()
        b = ballot(S=[0, 1, 2, 3], B=[4])
        self.assertTrue(check_proof(b, projects, tiers, [1, 2, 3]))
        self.assertFalse(check_proof(b, projects, tiers, [0, 1, 2]))
        self.assertFalse(check_proof(b, projects, tiers, [2, 3, 4]))
        self.assertFalse(check_proof(b, projects, tiers, [2, 3]))

    def test_tiers_of(self):
        self.assertEqual(tiers_of([1, 1, 3, W, 3, 1]), [[0, 1, 5], [2, 4]])


if __name__ == "__main__":
    unittest.main()
