"""Independent integer reference for the production three-stage quiet ending.

Input is a JSON history of block states and ballot receipts. The tally deliberately
recounts support rather than sharing the optimized TypeScript implementation.
Run with a JSON history on stdin to print its replay audit.
"""

import json
import sys

TIERS = ["S", "A", "B"]


def tier_of(ballot, project):
    if ballot is None or ballot[project] == 255:
        return 999
    return sorted(set(x for x in ballot if x != 255)).index(ballot[project])


def replay(history):
    schedule, m, now = history["schedule"], history["m"], history["now"]
    states = history["states"]
    receipts = [r for r in history["receipts"] if r["timestamp"] < now]
    accepted, rejected, settled = {}, [], []
    events = sorted(set(r["timestamp"] for r in receipts) | {
        s["timestamp"] for s in states if s["event"] and s["timestamp"] < now
    })
    applied = 0

    def ends(t):
        at, out = schedule["firstTallyAt"][t], []
        for k in range(schedule["maxWindows"]):
            at += schedule["initialWindow"] // (2 ** k)
            out.append(at)
        return out

    def state_before(time):
        found = [s for s in states if s["timestamp"] < time]
        if not found:
            raise ValueError("no chain state")
        return found[-1]

    def deadline():
        return settled[0]["at"] if settled else ends(0)[-1]

    def apply_before(time):
        nonlocal applied
        while applied < len(receipts) and receipts[applied]["timestamp"] < time:
            r = receipts[applied]
            applied += 1
            token = r["tokenId"]
            if r["ballot"] is None:
                accepted.pop(token, None)
                continue
            reason = None
            if token not in accepted and r["timestamp"] >= deadline():
                reason = "registration_closed"
            raw = r["ballot"]
            counts = {rank: raw.count(rank) for rank in set(raw) if rank != 255}
            seen = 0
            valid = bool(counts) and 0 < len(raw) <= m
            for rank in sorted(counts):
                valid = valid and rank == seen + 1
                seen += counts[rank]
            if reason is None and not valid:
                reason = "invalid_ballot"
            ballot = raw + [255] * (m - len(raw))
            if reason is None and token in accepted:
                old = accepted[token]
                for t in range(len(settled)):
                    if {c for c in range(m) if tier_of(old, c) == t} != {
                        c for c in range(m) if tier_of(ballot, c) == t
                    }:
                        reason = "tier_settled"
                        break
            if reason:
                rejected.append({"tokenId": token, "nonce": r["nonce"], "reason": reason})
            else:
                accepted[token] = ballot

    def look(first, state, all_stages=False):
        costs = [int(x) for x in state["asks"]] + [0] * (m - len(state["asks"]))
        voters = sorted(accepted)
        pool = int(state["poolUsd"])
        weights = {v: pool // len(voters) for v in voters} if voters else {}
        finished = set()
        spent = 0
        for s in settled:
            finished.update(s["funded"] + s["covered"])
            spent += sum(int(x) for x in s["awards"].values())
            for charges in s["shares"].values():
                for v, charge in charges.items():
                    weights[v] -= int(charge)
        withdrawn = {i for i, flag in enumerate(state.get("withdrawn", [])) if flag} - finished
        covered = {i for i, ask in enumerate(state["asks"]) if int(ask) == 0} - finished - withdrawn
        stages = []
        for t in range(first, 3 if all_stages else first + 1):
            bound = m if t == 2 else max([1] + [
                sorted(set(x for x in b if x != 255))[k]
                for b in accepted.values() for k in range(t + 1)
                if len(set(x for x in b if x != 255)) > k
            ])
            order, shares = [], {}
            for level in range(1, min(m, bound) + 1):
                while True:
                    choices = []
                    for c in range(m):
                        if c in finished or c in withdrawn or costs[c] <= 0 or costs[c] > pool - spent:
                            continue
                        payers = [v for v in voters if accepted[v][c] <= level and weights[v] > 0]
                        support = sum(weights[v] for v in payers)
                        if support >= costs[c]:
                            choices.append((-support, costs[c], c, payers))
                    if not choices:
                        break
                    neg_support, cost, c, payers = min(choices)
                    total, cumulative, paid = -neg_support, 0, {}
                    for v in payers:
                        next_weight = cumulative + weights[v]
                        charge = next_weight * cost // total - cumulative * cost // total
                        cumulative = next_weight
                        weights[v] -= charge
                        paid[v] = str(charge)
                    shares[str(c)] = paid
                    order.append(c)
                    finished.add(c)
                    spent += cost
            stages.append({"funded": order, "shares": shares,
                           "awards": {str(c): str(costs[c]) for c in order}})
        return {"stages": stages, "covered": sorted(covered), "withdrawn": sorted(withdrawn)}

    def same(a, b):
        omit = set(a["covered"] + b["covered"] + a["withdrawn"] + b["withdrawn"])
        return set(a["stages"][0]["funded"]) - omit == set(b["stages"][0]["funded"]) - omit

    tiers = []
    for t in range(3):
        start = schedule["firstTallyAt"][t]
        if now < start or len(settled) < t:
            tiers.append({"tier": TIERS[t], "status": "waiting", "startsAt": start})
            continue
        apply_before(start)
        baseline = look(t, state_before(start))
        window_start = start
        for k, end in enumerate(ends(t)):
            quiet = True
            for time in [x for x in events if window_start <= x < min(end, now)]:
                apply_before(time + 1)
                quiet = same(look(t, state_before(time + 1)), baseline) and quiet
            apply_before(min(end, now))
            latest = look(t, state_before(min(end, now)))
            if now < end:
                tiers.append({"tier": TIERS[t], "status": "settling", "window": k + 1,
                              "windowEndsAt": end, "latestEndAt": ends(t)[-1], "quiet": quiet,
                              "funded": latest["stages"][0]["funded"],
                              "covered": latest["covered"], "withdrawn": latest["withdrawn"]})
                break
            quiet = same(latest, baseline) and quiet
            if quiet or k == schedule["maxWindows"] - 1:
                result = {"tier": TIERS[t], "status": "settled", "at": end,
                          "forced": not quiet, **latest["stages"][0],
                          "covered": latest["covered"], "withdrawn": latest["withdrawn"]}
                settled.append(result)
                tiers.append(result)
                break
            baseline, window_start = latest, end
    apply_before(now)
    head = state_before(now)
    live = look(len(settled), head, True) if len(settled) < 3 else {"stages": [], "covered": [], "withdrawn": []}
    return {"tiers": tiers, "accepted": accepted, "rejected": rejected,
            "share": str(int(head["poolUsd"]) // len(accepted)) if accepted else "0",
            "registrationClosesAt": deadline(), "live": live}


if __name__ == "__main__":
    print(json.dumps(replay(json.load(sys.stdin))))
