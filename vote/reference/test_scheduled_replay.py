import unittest

from export_scheduled_fixtures import cases


class ScheduledReplay(unittest.TestCase):
    def test_seeded_histories_conserve_historical_budget_and_each_badge_share(self):
        for case in cases(1000):
            if "error" in case:
                continue
            history, result = case["history"], case["expected"]
            charges, spent = {}, 0
            for tier in result["tiers"]:
                if tier["status"] != "settled":
                    continue
                state = [s for s in history["states"] if s["timestamp"] < tier["at"]][-1]
                pool = int(state["poolUsd"])
                spent += sum(int(x) for x in tier["awards"].values())
                self.assertLessEqual(spent, pool, case["name"])
                for shares in tier["shares"].values():
                    for token, amount in shares.items():
                        self.assertGreaterEqual(int(amount), 0)
                        charges[token] = charges.get(token, 0) + int(amount)
                # A first ballot may also join during S-Tier's windows.
                registered = len(result["accepted"])
                for amount in charges.values():
                    self.assertLessEqual(amount, pool // registered, case["name"])
            if history["now"] == 3500:
                self.assertTrue(all(t["status"] == "settled" for t in result["tiers"]))

    def test_committed_fixtures_match_the_reference(self):
        import json
        from pathlib import Path
        saved = Path(__file__).resolve().parents[2] / "shared/vote/fixtures/scheduled-replay.json"
        self.assertEqual(json.loads(saved.read_text()), list(cases()))

    def test_unchanged_inputs_match_plain_pbear(self):
        import random
        from pbear import pbear
        from scheduled_replay import replay
        rng = random.Random(16112026)
        for _ in range(500):
            m, n = rng.randint(2, 7), rng.randint(1, 6)
            costs = [rng.randint(1, 100) for _ in range(m)]
            weight = rng.randint(1, 100)
            ballots = []
            for _ in range(n):
                groups = [rng.randrange(3) for _ in range(m)]
                ballots.append([1 + sum(x < g for x in groups) for g in groups])
            history = {"m":m,"now":400,"schedule":{"opensAt":0,"firstTallyAt":[100,200,300],"initialWindow":10,"maxWindows":2},
                       "states":[{"block":0,"timestamp":0,"asks":list(map(str,costs)),"poolUsd":str(n*weight),"withdrawn":[],"event":False}],
                       "receipts":[{"tokenId":str(i),"nonce":1,"block":i+1,"timestamp":i+1,"ballot":b} for i,b in enumerate(ballots)]}
            result = replay(history)
            self.assertEqual([c for t in result["tiers"] for c in t["funded"]], pbear(costs, [(weight,b) for b in ballots]))


if __name__ == "__main__":
    unittest.main()
