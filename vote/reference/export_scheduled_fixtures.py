"""Deterministic complete-history parity cases; run from the repository root.

python3 vote/reference/export_scheduled_fixtures.py > shared/vote/fixtures/scheduled-replay.json
"""
import copy
import json
import random
import sys

from scheduled_replay import replay


def cases(count=40, seed=16112026):
    rng = random.Random(seed)
    schedule = {"opensAt": 0, "firstTallyAt": [1000, 2000, 3000],
                "initialWindow": 100, "maxWindows": 3}
    for k in range(count):
        m, n = rng.randint(2, 7), rng.randint(1, 6)
        pool = rng.randint(60, 300)

        def ballot():
            groups = [rng.randrange(4) for _ in range(m)]
            groups[0] = rng.randrange(3)
            return [255 if g == 3 else 1 + sum(x < g for x in groups) for g in groups]

        receipts = [{"tokenId": str(i + 1), "nonce": 1, "block": 100 + i,
                     "timestamp": 100 + i, "ballot": ballot()} for i in range(n)]
        # A late registration, boundary revision and ordinary later revisions exercise
        # rejection and whole-ballot replacement as well as economic events.
        for time in [1050, 1100, 1120, 2100, 3050]:
            receipts.append({"tokenId": str(rng.randint(1, n + 1)), "nonce": time,
                             "block": time, "timestamp": time, "ballot": ballot()})
        receipts.sort(key=lambda x: x["block"])
        states = []
        for time in [0, 1040, 1080, 1100, 1130, 1500, 2040, 2080, 2130, 2500, 3040, 3080, 3130]:
            pool += rng.randint(0, 60)
            states.append({"block": time, "timestamp": time,
                           "asks": [str(rng.randint(0, 160)) for _ in range(m)],
                           "poolUsd": str(pool), "withdrawn": [rng.random() < .1 for _ in range(m)],
                           "event": time != 0})
        history = {"schedule": schedule, "m": m, "states": states,
                   "receipts": receipts, "now": [1070, 1140, 1800, 2150, 3500][k % 5]}
        yield {"name": f"seed {seed}, history {k}", "history": history, "expected": replay(history)}

    # Original post-settlement donation example: the second project stays unfunded.
    history = {"schedule": schedule, "m": 2, "now": 3500,
               "receipts": [{"tokenId": "1", "nonce": 1, "block": 1, "timestamp": 1, "ballot": [1, 2]}],
               "states": [{"block": 0, "timestamp": 0, "asks": ["60", "60"], "poolUsd": "100", "withdrawn": [], "event": False},
                          {"block": 1500, "timestamp": 1500, "asks": ["10", "60"], "poolUsd": "100", "withdrawn": [], "event": True}]}
    yield {"name": "donation after settlement preserves the award", "history": history, "expected": replay(history)}
    # A burn before the first settlement removes the voting unit. Two revisions in
    # one block are compared only after that block's last receipt.
    burned = copy.deepcopy(history)
    burned["receipts"] = [
        {"tokenId":"1","nonce":1,"block":1,"timestamp":1,"ballot":[1,2]},
        {"tokenId":"2","nonce":1,"block":2,"timestamp":2,"ballot":[1,2]},
        {"tokenId":"2","nonce":2,"block":1050,"timestamp":1050,"ballot":[2,1]},
        {"tokenId":"2","nonce":3,"block":1050,"timestamp":1050,"ballot":[1,2]},
        {"tokenId":"2","nonce":0,"block":1060,"timestamp":1060,"ballot":None},
    ]
    yield {"name":"burn and same-block revisions", "history":burned, "expected":replay(burned)}
    # Missing historical state is an error, never an all-zero tally.
    missing = copy.deepcopy(history)
    missing["states"] = missing["states"][1:]
    yield {"name": "missing historical state", "history": missing, "error": "no chain state"}


if __name__ == "__main__":
    json.dump(list(cases()), sys.stdout, indent=1)
    print()
