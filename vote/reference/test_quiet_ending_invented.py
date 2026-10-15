"""Quiet Ending at 200 badge holders and 200 invented proposals asking about seven times
the pool: `World(seed, proposals=200)` in `quiet_ending_sim`. With many small proposals
the tail of the funded set is unstable, which is where the settling rules differ most.
`test_quiet_ending_scale` runs the same experiments on the real proposals.
"""

import random
import unittest

from pbear import pbear
from quiet_ending import RULES, tally
from quiet_ending_sim import MAX_EXTENSIONS, POOL, World

SEEDS = range(6)


class AtTheDeadline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rounds = [(World(seed, proposals=200), World(seed, proposals=200).first_deadline()) for seed in SEEDS]

    def changed(self, key, rule=None):
        return [
            len(set(d[key][rule] if rule else d[key]) ^ set(d["funded"])) for _, d in self.rounds
        ]

    def test_the_model_tally_is_pbear_at_full_size(self):
        world = World(0, proposals=200)
        voters, loose = world.profiles("any")(1, [], [])
        self.assertEqual(tally(world.costs, voters, loose)[0], pbear(world.costs, voters, loose))

    def test_a_group_arriving_in_the_window_extends_every_round(self):
        for _, d in self.rounds:
            self.assertGreater(len(d["contested"]), 0)
            self.assertGreater(len(d["locked_in"]), len(d["contested"]))

    def test_replay_reproduces_the_deadline_result_in_every_round(self):
        self.assertEqual(self.changed("again", "replay"), [0] * len(self.rounds))

    def test_reset_breaks_the_deadline_result_in_every_round(self):
        self.assertTrue(all(n >= 2 for n in self.changed("again", "reset")))

    def test_frozen_breaks_the_deadline_result_in_most_rounds_but_less_than_reset(self):
        frozen, reset = self.changed("again", "frozen"), self.changed("again", "reset")
        self.assertGreaterEqual(sum(n > 0 for n in frozen), len(self.rounds) // 2)
        self.assertLess(sum(frozen), sum(reset))

    def test_taking_locked_out_proposals_off_the_ballots_breaks_the_deadline_result(self):
        removed = self.changed("removed")
        self.assertGreaterEqual(sum(n > 0 for n in removed), len(self.rounds) - 1)
        self.assertGreater(sum(removed) / len(removed), 3)


class WholeRounds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.outcomes = [(World(seed, proposals=200), {rule: World(seed, proposals=200).play(rule) for rule in RULES}) for seed in SEEDS]

    def test_every_round_ends_in_time_with_the_locks_and_the_pool_respected(self):
        for world, by_rule in self.outcomes:
            for rule, outcome in by_rule.items():
                self.assertLessEqual(outcome["extensions"], MAX_EXTENSIONS, rule)
                self.assertGreaterEqual(outcome["extensions"], 1, rule)
                self.assertLessEqual(set(outcome["locked_in"]), set(outcome["funded"]), rule)
                self.assertFalse(set(outcome["funded"]) & outcome["locked_out"], rule)
                self.assertLessEqual(sum(world.costs[c] for c in outcome["funded"]), POOL, rule)
                for earlier, later in zip(outcome["contested"], outcome["contested"][1:]):
                    self.assertLessEqual(set(later), set(earlier), rule)

    def test_only_reset_uses_weight_that_was_already_spent(self):
        for world, by_rule in self.outcomes:
            dollars, voters = world.overpaid(by_rule["reset"])
            self.assertGreater(dollars, 1_000)
            self.assertGreater(voters, 5)
            for rule in ("replay", "frozen"):
                self.assertEqual(world.overpaid(by_rule[rule]), (0, 0), rule)

    def test_no_rule_ends_on_the_fresh_tally_of_the_final_ballots(self):
        # Settling is not free: several proposals a fresh tally would fund are locked
        # out, and as many it would not fund are locked in.
        for rule in RULES:
            differs = []
            for world, by_rule in self.outcomes:
                outcome = by_rule[rule]
                loose = POOL - sum(w for w, _ in outcome["voters"])
                fresh = tally(world.costs, outcome["voters"], loose)[0]
                differs.append(len(set(fresh) ^ set(outcome["funded"])))
            self.assertGreater(sum(differs) / len(differs), 5, rule)


class InSteps(unittest.TestCase):
    """Quiet Ending in steps on the deadline ballots of three rounds."""

    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed, proposals=200) for seed in range(3)]
        cls.plain = [world.play_in_steps() for world in cls.worlds]
        cls.crowd = [world.play_in_steps(range(world.n)) for world in cls.worlds]

    def test_without_revisions_it_is_plain_pbear(self):
        for world, result in zip(self.worlds, self.plain):
            voters, loose = world.profiles("any")(1, [], [])
            self.assertEqual(result["funded"], pbear(world.costs, voters, loose))

    def test_there_are_dozens_of_pauses(self):
        for result in self.plain + self.crowd:
            self.assertGreater(len(result["steps"]), 25)
            self.assertLess(len(result["steps"]), 80)

    def test_with_everyone_revising_the_accounts_still_balance(self):
        for world, result in zip(self.worlds, self.crowd):
            self.assertLessEqual(result["spent"], POOL)
            self.assertEqual(result["spent"], sum(world.costs[c] for c in result["funded"]))
            paid = [0] * world.n
            for c, _, shares in result["steps"]:
                self.assertEqual(sum(shares.values()), world.costs[c])
                for i, d in shares.items():
                    paid[i] += d
            self.assertTrue(all(w >= 0 for w in result["weights"]))
            self.assertLessEqual(max(paid), POOL // sum(b is not None for b in result["ballots"]))
            left = sum(w for w, b in zip(result["weights"], result["ballots"]) if b is not None)
            self.assertTrue(all(left < world.costs[c] for c in range(world.m) if c not in result["funded"]))

    def test_with_everyone_revising_the_result_moves_away_from_the_plain_one(self):
        moved = [len(set(a["funded"]) ^ set(b["funded"])) for a, b in zip(self.plain, self.crowd)]
        self.assertGreater(sum(moved) / len(moved), 3)


    def test_tier_pauses_fall_at_three_moments_and_change_nothing_by_themselves(self):
        for world, plain in zip(self.worlds, self.plain):
            result = world.play_in_steps(tiers=3, watch=True)
            self.assertEqual(result["funded"], plain["funded"])
            pauses = result["pauses"]
            # S tiers are all counted at level 1; A tiers when the level reaches one
            # more than the largest S tier (5); B tiers one more than the largest S
            # and A together (13).
            self.assertEqual([p["level"] for p in pauses], [1, 6, 14])
            self.assertLess(pauses[0]["funded"], pauses[1]["funded"])
            self.assertLess(pauses[1]["funded"], pauses[2]["funded"])
            # About half the pool is already spent at the first pause.
            self.assertGreater(pauses[0]["spent"], POOL * 4 // 10)
            self.assertGreater(pauses[2]["spent"], POOL * 85 // 100)


    def test_revising_only_the_uncounted_part_ends_on_the_plain_tally_of_the_final_ballots(self):
        for world in self.worlds:
            result = world.play_in_steps(range(world.n), tiers=3, revision="below")
            voters = [(w + sum(s.get(i, 0) for _, _, s in result["steps"]), b) for i, (w, b) in enumerate(
                zip(result["weights"], result["ballots"])
            )]
            self.assertGreater(sum(a != b for a, b in zip(result["ballots"], world.play_in_steps()["ballots"])), 5)
            self.assertEqual(result["funded"], tally(world.costs, voters, POOL - sum(w for w, _ in voters))[0])

    def test_promoting_into_the_top_tier_does_not(self):
        differs = 0
        for world in self.worlds:
            result = world.play_in_steps(range(world.n), tiers=3, revision="promote")
            voters = [(w + sum(s.get(i, 0) for _, _, s in result["steps"]), b) for i, (w, b) in enumerate(
                zip(result["weights"], result["ballots"])
            )]
            fresh = tally(world.costs, voters, POOL - sum(w for w, _ in voters))[0]
            differs += len(set(result["funded"]) ^ set(fresh))
        self.assertGreater(differs, 3 * len(self.worlds))


class ByLevel(unittest.TestCase):
    """A pause at each rank level that funded something, with the counted part of every
    ballot locked."""

    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed, proposals=200) for seed in range(4)]
        cls.plain = [world.play_in_steps()["funded"] for world in cls.worlds]

    def best_liked_unfunded(self, world, plain):
        likes = [0] * world.m
        for i in range(world.n):
            if world.arrival[i] is not None and world.arrival[i] <= 1:
                for c in sorted(range(world.m), key=lambda c: -world.utility[i][c])[: world.favourites]:
                    likes[c] += 1
        return max((c for c in range(world.m) if c not in plain), key=lambda c: likes[c])

    def test_the_pauses_change_nothing_by_themselves(self):
        for world, plain in zip(self.worlds, self.plain):
            result = world.play_by_level()
            self.assertEqual(result["funded"], plain)
            days = result["days"]
            self.assertGreater(len(days), 8)
            self.assertLess(len(days), 25)
            # The first pause follows level 1, where about half of everything is funded.
            self.assertEqual(days[0]["level"], 1)
            self.assertGreater(days[0]["funded"], len(plain) // 3)
            self.assertTrue(all(day["funded"] >= 1 for day in days))
            self.assertEqual([day["level"] for day in days], sorted({day["level"] for day in days}))

    def test_with_everyone_reacting_the_result_is_the_plain_tally_of_the_final_ballots(self):
        moved = 0
        for world, plain in zip(self.worlds, self.plain):
            result = world.play_by_level(range(world.n))
            loose = POOL - sum(w for w, _ in result["voters"])
            self.assertEqual(result["funded"], tally(world.costs, result["voters"], loose)[0])
            moved += len(set(result["funded"]) ^ set(plain))
        self.assertGreater(moved, 2 * len(self.worlds))

    def test_a_campaign_works_early_and_not_late(self):
        wins = {1: 0, 8: 0}
        for world, plain in zip(self.worlds, self.plain):
            target = self.best_liked_unfunded(world, plain)
            for day in wins:
                result = world.play_by_level(campaign=(day, target))
                wins[day] += target in result["funded"]
                loose = POOL - sum(w for w, _ in result["voters"])
                self.assertEqual(result["funded"], tally(world.costs, result["voters"], loose)[0])
        self.assertGreaterEqual(wins[1], 3)
        self.assertLessEqual(wins[8], 1)


class Daily(unittest.TestCase):
    """Quiet Ending by tiers with a daily tally, holders reacting from the second day."""

    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed, proposals=200) for seed in range(4)]
        cls.prefix = [world.play_daily("prefix") for world in cls.worlds]
        cls.both = [world.play_daily("both") for world in cls.worlds]

    def fresh(self, world, result):
        return tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]

    def test_rounds_end_within_days_without_the_day_limit(self):
        for result in self.prefix + self.both:
            self.assertEqual(result["forced"], [])
            self.assertGreaterEqual(len(result["days"]), 4)
            self.assertLessEqual(len(result["days"]), 12)

    def test_the_late_group_holds_back_most_of_the_first_tier_at_the_deadline(self):
        for world, result in zip(self.worlds, self.prefix):
            first = result["days"][0]
            self.assertFalse(first["quiet"])
            self.assertLess(first["accepted"], first["tally"])

    def test_the_accounts_balance(self):
        for world, result in zip(self.worlds * 2, self.prefix + self.both):
            self.assertLessEqual(sum(world.costs[c] for c in result["funded"]), POOL)
            paid = [0] * world.n
            for c in result["funded"]:
                self.assertEqual(sum(result["paid"][c].values()), world.costs[c])
                for i, d in result["paid"][c].items():
                    paid[i] += d
            for (w, _), spent, left in zip(result["voters"], paid, result["weights"]):
                self.assertEqual(w - spent, left)
                self.assertGreaterEqual(left, 0)

    def test_accepting_in_tally_order_ends_closer_to_the_plain_tally_of_the_final_ballots(self):
        def distance(results):
            return sum(len(set(r["funded"]) ^ set(self.fresh(w, r))) for w, r in zip(self.worlds, results))

        self.assertLess(distance(self.prefix), distance(self.both))
        self.assertLess(distance(self.prefix), 4 * len(self.worlds))


    def test_a_halving_schedule_for_the_whole_round_ends_within_a_day_of_the_deadline(self):
        off = []
        for world, daily in zip(self.worlds, self.prefix):
            result = world.play_daily(hours=(24, 1, False))
            self.assertLessEqual(result["hours_after_deadline"], 22.5)
            self.assertLess(result["hours_after_deadline"], daily["hours_after_deadline"])
            self.assertEqual(result["forced"], [])
            # The later tiers get only what is left of the schedule.
            first_window = {d["stage"]: d["hours"] for d in reversed(result["days"])}
            self.assertEqual(first_window[0], 24)
            self.assertLessEqual(first_window[1], 6)
            self.assertLessEqual(first_window[3], 1.5)
            off.append(len(set(result["funded"]) ^ set(self.fresh(world, result))))
        # Usually the plain tally of the final ballots or close to it, occasionally not.
        self.assertLess(sum(off) / len(off), 4)


class TierAcceptedWhole(unittest.TestCase):
    def test_it_ends_on_the_plain_tally_of_the_final_ballots_in_the_same_order(self):
        for seed in range(6):
            world = World(seed, proposals=200)
            result = world.play_daily("tier", payers_locked=False, hours=(24, 1, True), newcomers="percent")
            voters = result["voters"]
            self.assertEqual(result["funded"], tally(world.costs, voters, POOL - sum(w for w, _ in voters))[0])
            self.assertLessEqual(result["hours_after_deadline"], 22.5 + 3 * 46.5)


class Sensitivity(unittest.TestCase):
    def test_a_single_new_ballot_usually_changes_several_results(self):
        # The premise of a quiet window is that the result can stand still. At this
        # size it rarely does: one more ballot moves the tail of the funded set.
        rng = random.Random(0)
        flips = [World(seed, proposals=200).flips_from_new_ballots(1, rng) for seed in SEEDS for _ in range(3)]
        self.assertGreater(sum(flips) / len(flips), 3)
        self.assertGreater(sum(f > 0 for f in flips), len(flips) * 2 // 3)


if __name__ == "__main__":
    unittest.main()
