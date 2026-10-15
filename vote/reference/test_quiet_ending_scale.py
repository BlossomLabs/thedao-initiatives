"""Quiet Ending on real proposals: the 49 initiatives of TheDAO Security Fund, each
asking 25% less than on its page and at most $200,000, a $1,000,000 pool and 200
invented badge holders (`quiet_ending_sim`). The small-instance tests say what can go
wrong; these say how often and how much it does in a round of this shape.
`python3 reference/quiet_ending_sim.py` prints the numbers.

With 49 proposals asking 4.4 times the pool the result is far steadier than with the
200 small invented proposals of `test_quiet_ending_invented`, so several effects that
are large there are small here.
"""

import random
import unittest

from pbear import pbear
from quiet_ending import RULES, tally
from quiet_ending_sim import DEFENCES, INITIATIVES, MAX_EXTENSIONS, POOL, World, defended, sealed_day

SEEDS = range(8)


def fresh(world, result):
    """The plain tally of the ballots a round ended with."""
    return tally(world.costs, result["voters"], POOL - sum(w for w, _ in result["voters"]))[0]


def distance(a, b):
    return len(set(a) ^ set(b))


class TheProposals(unittest.TestCase):
    def test_costs_are_the_asks_less_a_quarter_capped_at_200_000(self):
        self.assertEqual(len(INITIATIVES), 49)
        self.assertEqual(sum(i["asked"] for i in INITIATIVES), 6_736_690)
        for initiative in INITIATIVES:
            self.assertEqual(initiative["cost"], min(200_000, round(initiative["asked"] * 0.75)))
        self.assertEqual(sum(i["cost"] for i in INITIATIVES), 4_400_767)
        self.assertEqual(sum(i["cost"] == 200_000 for i in INITIATIVES), 6)

    def test_the_world_uses_them(self):
        world = World(0)
        self.assertEqual((world.n, world.m, world.groups), (200, 49, 10))
        self.assertEqual(world.costs, [i["cost"] * 10**6 for i in INITIATIVES])
        voters, loose = world.profiles("any")(1, [], [])
        funded = pbear(world.costs, voters, loose)
        self.assertEqual(tally(world.costs, voters, loose)[0], funded)
        self.assertGreater(len(funded), 15)
        self.assertLess(len(funded), 35)


class AtTheDeadline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rounds = [World(seed).first_deadline() for seed in SEEDS]

    def changed(self, key, rule=None):
        return [distance(d[key][rule] if rule else d[key], d["funded"]) for d in self.rounds]

    def test_a_group_arriving_in_the_window_extends_most_rounds_over_a_few_proposals(self):
        contested = [len(d["contested"]) for d in self.rounds]
        self.assertGreaterEqual(sum(n > 0 for n in contested), len(self.rounds) // 2)
        self.assertLess(max(contested), 10)
        for d in self.rounds:
            self.assertGreater(len(d["locked_in"]), 3 * len(d["contested"]))

    def test_replay_reproduces_the_deadline_result_in_every_round(self):
        self.assertEqual(self.changed("again", "replay"), [0] * len(self.rounds))

    def test_reset_breaks_the_deadline_result_in_some_rounds(self):
        reset = self.changed("again", "reset")
        self.assertGreaterEqual(sum(n > 0 for n in reset), 3)
        self.assertGreater(sum(reset), sum(self.changed("again", "frozen")))

    def test_frozen_holds_here(self):
        # It breaks in most rounds with 200 small proposals; with these it does not.
        self.assertEqual(self.changed("again", "frozen"), [0] * len(self.rounds))

    def test_taking_locked_out_proposals_off_the_ballots_can_break_the_deadline_result(self):
        self.assertGreater(sum(self.changed("removed")), 0)


class WholeRounds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.outcomes = [(World(seed), {rule: World(seed).play(rule) for rule in RULES}) for seed in SEEDS]

    def test_every_round_ends_in_time_with_the_locks_and_the_pool_respected(self):
        for world, by_rule in self.outcomes:
            for rule, outcome in by_rule.items():
                self.assertLessEqual(outcome["extensions"], MAX_EXTENSIONS, rule)
                self.assertLessEqual(set(outcome["locked_in"]), set(outcome["funded"]), rule)
                self.assertFalse(set(outcome["funded"]) & outcome["locked_out"], rule)
                self.assertLessEqual(sum(world.costs[c] for c in outcome["funded"]), POOL, rule)
                for earlier, later in zip(outcome["contested"], outcome["contested"][1:]):
                    self.assertLessEqual(set(later), set(earlier), rule)

    def test_only_reset_uses_weight_that_was_already_spent(self):
        reused = 0
        for world, by_rule in self.outcomes:
            dollars, voters = world.overpaid(by_rule["reset"])
            reused += dollars
            self.assertEqual(dollars > 0, by_rule["reset"]["extensions"] > 0)
            for rule in ("replay", "frozen"):
                self.assertEqual(world.overpaid(by_rule[rule]), (0, 0), rule)
        self.assertGreater(reused / len(self.outcomes), 20_000)

    def test_settling_can_end_away_from_the_fresh_tally_of_the_final_ballots(self):
        for rule in RULES:
            differs = [distance(fresh(world, by_rule[rule]), by_rule[rule]["funded"]) for world, by_rule in self.outcomes]
            self.assertGreater(sum(differs), 0, rule)
            self.assertLess(sum(differs) / len(differs), 4, rule)


class InSteps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed) for seed in SEEDS]
        cls.plain = [world.play_in_steps() for world in cls.worlds]
        cls.crowd = [world.play_in_steps(range(world.n)) for world in cls.worlds]

    def test_without_revisions_it_is_plain_pbear(self):
        for world, result in zip(self.worlds, self.plain):
            voters, loose = world.profiles("any")(1, [], [])
            self.assertEqual(result["funded"], pbear(world.costs, voters, loose))

    def test_a_pause_per_funded_proposal_is_about_two_dozen_pauses(self):
        for result in self.plain + self.crowd:
            self.assertGreater(len(result["steps"]), 15)
            self.assertLess(len(result["steps"]), 35)

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

    def test_with_everyone_revising_the_result_moves_in_some_rounds(self):
        moved = [distance(a["funded"], b["funded"]) for a, b in zip(self.plain, self.crowd)]
        self.assertGreater(sum(moved), 0)
        self.assertLess(sum(moved) / len(moved), 4)

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
            self.assertGreater(pauses[2]["spent"], POOL * 8 // 10)

    def test_revising_only_the_uncounted_part_ends_on_the_plain_tally_of_the_final_ballots(self):
        for world, plain in zip(self.worlds, self.plain):
            result = world.play_in_steps(range(world.n), tiers=3, revision="below")
            voters = [(w + sum(s.get(i, 0) for _, _, s in result["steps"]), b) for i, (w, b) in enumerate(
                zip(result["weights"], result["ballots"])
            )]
            self.assertGreater(sum(a != b for a, b in zip(result["ballots"], plain["ballots"])), 5)
            self.assertEqual(result["funded"], tally(world.costs, voters, POOL - sum(w for w, _ in voters))[0])

    def test_promoting_into_the_top_tier_does_not(self):
        differs = 0
        for world in self.worlds:
            result = world.play_in_steps(range(world.n), tiers=3, revision="promote")
            voters = [(w + sum(s.get(i, 0) for _, _, s in result["steps"]), b) for i, (w, b) in enumerate(
                zip(result["weights"], result["ballots"])
            )]
            differs += distance(result["funded"], tally(world.costs, voters, POOL - sum(w for w, _ in voters))[0])
        self.assertGreater(differs, 0)


class ByLevel(unittest.TestCase):
    """A pause at each rank level that funded something, with the counted part of every
    ballot locked."""

    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed) for seed in SEEDS]
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
            self.assertGreater(len(days), 4)
            self.assertLess(len(days), 16)
            # The first pause follows level 1, where about half of everything is funded.
            self.assertEqual(days[0]["level"], 1)
            self.assertGreater(days[0]["funded"], len(plain) // 3)
            self.assertTrue(all(day["funded"] >= 1 for day in days))
            self.assertEqual([day["level"] for day in days], sorted({day["level"] for day in days}))

    def test_with_everyone_reacting_the_result_is_the_plain_tally_of_the_final_ballots(self):
        for world in self.worlds:
            result = world.play_by_level(range(world.n))
            self.assertEqual(result["funded"], fresh(world, result))

    def test_a_campaign_for_the_best_liked_unfunded_proposal_rarely_works_and_never_late(self):
        # These proposals are large: the best-liked one left out usually costs more
        # than everyone who likes it has left after the first tier.
        wins = {1: 0, 5: 0}
        for world, plain in zip(self.worlds, self.plain):
            target = self.best_liked_unfunded(world, plain)
            for day in wins:
                result = world.play_by_level(campaign=(day, target))
                wins[day] += target in result["funded"]
                self.assertEqual(result["funded"], fresh(world, result))
        self.assertLessEqual(wins[1], len(self.worlds) // 2)
        self.assertEqual(wins[5], 0)


class Daily(unittest.TestCase):
    """Quiet Ending by tiers with a daily tally, holders reacting from the second day."""

    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed) for seed in SEEDS]
        cls.prefix = [world.play_daily("prefix") for world in cls.worlds]
        cls.both = [world.play_daily("both") for world in cls.worlds]

    def test_rounds_end_within_days_without_the_day_limit(self):
        for result in self.prefix + self.both:
            self.assertEqual(result["forced"], [])
            self.assertGreaterEqual(len(result["days"]), 4)
            self.assertLessEqual(len(result["days"]), 10)

    def test_the_first_tier_is_held_back_at_the_deadline_when_the_late_group_moves_it(self):
        held = 0
        for result in self.prefix:
            first = result["days"][0]
            self.assertLessEqual(first["accepted"], first["tally"])
            held += not first["quiet"]
        self.assertGreaterEqual(held, len(self.worlds) // 2)

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

    def test_accepting_in_tally_order_ends_on_the_plain_tally_of_the_final_ballots(self):
        prefix = [distance(r["funded"], fresh(w, r)) for w, r in zip(self.worlds, self.prefix)]
        both = [distance(r["funded"], fresh(w, r)) for w, r in zip(self.worlds, self.both)]
        self.assertEqual(sum(prefix), 0)
        self.assertLessEqual(sum(prefix), sum(both))

    def test_one_quiet_ending_per_tier_takes_three_to_four_days(self):
        for world in self.worlds:
            result = world.play_daily(hours=(24, 1, True))
            self.assertEqual(result["forced"], [])
            self.assertGreaterEqual(result["hours_after_deadline"], 72)
            self.assertLessEqual(result["hours_after_deadline"], 3 * 46.5 + 22.5)
            self.assertEqual(distance(result["funded"], fresh(world, result)), 0)

    def test_a_halving_schedule_for_the_whole_round_ends_within_a_day_of_the_deadline(self):
        for world, daily in zip(self.worlds, self.prefix):
            result = world.play_daily(hours=(24, 1, False))
            self.assertLessEqual(result["hours_after_deadline"], 22.5)
            self.assertLess(result["hours_after_deadline"], daily["hours_after_deadline"])
            self.assertEqual(result["forced"], [])
            # The later tiers get only what is left of the schedule.
            first_window = {d["stage"]: d["hours"] for d in reversed(result["days"])}
            self.assertEqual(first_window[0], 24)
            self.assertLessEqual(first_window[1], 12)
            self.assertLessEqual(first_window[3], 3)


class LateFirstBallots(unittest.TestCase):
    """One quiet ending per tier, with holders who submit their first ballot after the
    deadline handled in different ways."""

    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed) for seed in SEEDS]
        cls.by = {
            how: [world.play_daily(hours=(24, 1, True), newcomers=how) for world in cls.worlds]
            for how in ("closed", "percent", "units", "wait")
        }

    def counted(self, how):
        return sum(sum(b is not None for b in r["ballots"]) for r in self.by[how])

    def off(self, how):
        return sum(distance(r["funded"], fresh(w, r)) for w, r in zip(self.worlds, self.by[how]))

    def test_closing_the_roll_at_the_deadline_gives_the_plain_tally_of_the_final_ballots(self):
        self.assertEqual(self.off("closed"), 0)
        self.assertEqual(self.off("percent"), 0)

    def test_fixed_shares_count_more_voters_and_leave_more_unspent(self):
        self.assertGreater(self.counted("units"), self.counted("closed"))
        for closed, units in zip(self.by["closed"], self.by["units"]):
            self.assertGreater(max(w for w, _ in closed["voters"]), max(w for w, _ in units["voters"]))
        unspent = lambda how: sum(POOL - r["spent"] for r in self.by[how])
        self.assertGreater(unspent("units"), 2 * unspent("closed"))

    def test_late_first_ballots_take_the_result_away_from_the_plain_tally(self):
        # A ballot that arrives after its first tier was counted is counted late.
        self.assertGreater(self.off("units"), 0)
        self.assertGreater(self.off("wait"), 0)

    def test_making_first_ballots_wait_lengthens_the_first_tier(self):
        first_tier = lambda how: sum(sum(1 for d in r["days"] if d["stage"] == 0) for r in self.by[how])
        self.assertGreater(first_tier("wait"), first_tier("units"))
        self.assertGreater(first_tier("wait"), first_tier("closed"))

    def test_the_accounts_balance_however_they_are_handled(self):
        for results in self.by.values():
            for world, result in zip(self.worlds, results):
                self.assertLessEqual(result["spent"], POOL)
                paid = [0] * world.n
                for c in result["funded"]:
                    self.assertEqual(sum(result["paid"][c].values()), world.costs[c])
                    for i, d in result["paid"][c].items():
                        paid[i] += d
                for (w, _), spent, left in zip(result["voters"], paid, result["weights"]):
                    self.assertEqual(w - spent, left)
                    self.assertGreaterEqual(left, 0)


class TierAcceptedWhole(unittest.TestCase):
    def test_it_ends_on_the_plain_tally_of_the_final_ballots_in_the_same_order(self):
        for seed in range(6):
            world = World(seed)
            result = world.play_daily("tier", payers_locked=False, hours=(24, 1, True), newcomers="percent")
            voters = result["voters"]
            self.assertEqual(result["funded"], tally(world.costs, voters, POOL - sum(w for w, _ in voters))[0])
            self.assertLessEqual(result["hours_after_deadline"], 22.5 + 3 * 46.5)


class Attacks(unittest.TestCase):
    """The largest group acting together against one quiet ending per tier, each tier
    accepted whole, windows halving from 24 hours down to a minute (11 per tier)."""

    WINDOWS = 11

    @classmethod
    def setUpClass(cls):
        cls.worlds = [World(seed) for seed in range(6, 18)]
        defences = dict(DEFENCES)
        cls.none, cls.watched, cls.locked, cls.both = (
            defences[k] for k in ("none", "payments watched (4)", "supporters locked (1)", "both (1 and 4)")
        )

    def play(self, attack, defence):
        return [defended(world, attack, defence) for world in self.worlds]

    def first_tier(self, results):
        return [sum(1 for d in r["days"] if d["stage"] == 0) for r in results]

    def category(self, results):
        honest = self.play("step out", self.none)
        return sum(
            world.group_money(world.group[h["attackers"][0]], r["funded"])
            for world, r, h in zip(self.worlds, results, honest)
        )

    def assert_exact(self, results):
        for world, result in zip(self.worlds, results):
            self.assertEqual(result["funded"], fresh(world, result))

    def test_stepping_out_moves_the_result_unless_supporters_are_locked(self):
        quiet = self.play(None, self.none)
        open_ = self.play("step out", self.none)
        watched = self.play("step out", self.watched)
        locked = self.play("step out", self.both)

        def moved(results):
            return sum(set(r["funded"]) != set(q["funded"]) for r, q in zip(results, quiet))

        self.assertGreaterEqual(moved(open_), len(self.worlds) // 3)
        self.assertGreater(self.category(open_), self.category(quiet))
        # Watching payments gives time but, with nobody answering, the same result.
        self.assertEqual(self.category(watched), self.category(open_))
        self.assertLess(moved(locked), moved(open_))
        self.assertLess(self.category(locked), self.category(open_))
        self.assertGreater(sum(d["refused"] for r in locked for d in r["days"]), 10 * len(self.worlds))
        self.assertEqual(sum(d["refused"] for r in open_ for d in r["days"]), 0)
        for results in (open_, watched, locked):
            self.assert_exact(results)

    def test_flip_flopping_reaches_the_last_window_unless_supporters_are_locked(self):
        open_ = self.play("flip flop", self.watched)
        self.assertEqual(self.first_tier(open_), [self.WINDOWS] * len(self.worlds))
        self.assertTrue(all(0 in r["forced"] for r in open_))
        locked = self.play("flip flop", self.both)
        self.assertLessEqual(max(self.first_tier(locked)), 3)
        self.assertTrue(all(r["forced"] == [] for r in locked))
        self.assert_exact(open_)
        self.assert_exact(locked)

    def test_pushing_a_fresh_proposal_each_window_runs_out_before_the_last_one(self):
        fresh_moves = self.play("fresh", self.both)
        self.assertLess(max(self.first_tier(fresh_moves)), self.WINDOWS)
        self.assertTrue(all(r["forced"] == [] for r in fresh_moves))
        # Each push is paid for: the group ends with less for its own category.
        self.assertLess(self.category(fresh_moves), self.category(self.play(None, self.none)))
        self.assert_exact(fresh_moves)

    def test_a_tier_never_takes_more_than_its_two_days(self):
        for attack in ("step out", "flip flop", "fresh"):
            for result in self.play(attack, self.none):
                for stage in range(4):
                    self.assertLess(sum(d["hours"] for d in result["days"] if d["stage"] == stage), 48)


class SealedLastDay(unittest.TestCase):
    """The alternative to the whole Quiet Ending design: a hard deadline with the last
    day's ballots hidden, so that a group stepping out has to plan on the live result of
    the day before."""

    def gain(self, sealed, quiet_last_day=False):
        total = 0
        for seed in range(6, 18):
            world = World(seed)
            largest = max(range(world.groups), key=world.group.count)
            members = [i for i in range(world.n) if world.group[i] == largest]
            honest, attacked = sealed_day(world, [members], sealed, quiet_last_day)
            total += world.group_money(largest, attacked) - world.group_money(largest, honest)
        return total

    def test_stepping_out_pays_almost_as_well_blind(self):
        public, sealed = self.gain(False), self.gain(True)
        self.assertGreater(public, 0)
        self.assertGreater(sealed, public / 2)

    def test_and_just_as_well_when_few_others_vote_on_the_last_day(self):
        self.assertGreater(self.gain(True, quiet_last_day=True), self.gain(False, quiet_last_day=True) / 2)


class Sensitivity(unittest.TestCase):
    def test_a_single_new_ballot_usually_changes_nothing(self):
        # With 200 small proposals one more ballot moves about seven results. With
        # these 49 it usually moves none, so a quiet window can actually be quiet.
        rng = random.Random(0)
        flips = [World(seed).flips_from_new_ballots(1, rng) for seed in SEEDS for _ in range(3)]
        self.assertLess(sum(flips) / len(flips), 2)
        self.assertGreater(sum(f == 0 for f in flips), len(flips) // 2)


if __name__ == "__main__":
    unittest.main()
