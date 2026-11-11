"""The ballot rules (docs/superpowers/specs/2026-11-11-ballot-rules-design.md).

A valid ballot requests at least 1.5x the pool, and each enforced tier (Tier-S always,
Tier-A when the round says so) holds at least 3 pairwise-unrelated projects with no
related group over half its funds. Related = sharing a group (an affiliation); RFPs have none.

Ballots are in on-chain form: competition ranks, 255 = unplaced; a ballot shorter than
the projects reads the missing ones as unplaced. Mirrors shared/vote/rules.ts and the
contract; shared/vote/fixtures/ballot-rules.json keeps them equal.

`projects[i]` = {"askUsd": int, "rfp": bool, "groups": [int]}; amounts in micro-USD.
`independent_tiers`: bit 0 Tier-S, bit 1 Tier-A.
"""

WITHHELD = 255


def tiers_of(ballot):
    """Project indexes per group of equal rank, best rank first."""
    by_rank = {}
    for i, r in enumerate(ballot):
        if r != WITHHELD:
            by_rank.setdefault(r, []).append(i)
    return [by_rank[r] for r in sorted(by_rank)]


def _readable(ballot, m):
    if not 0 < len(ballot) <= m:
        return False
    if any(r != WITHHELD and not 1 <= r <= m for r in ballot):
        return False
    seen = 0
    for group in tiers_of(ballot):
        if ballot[group[0]] != seen + 1:
            return False
        seen += len(group)
    return True


def _related(projects, a, b):
    return bool(set(projects[a]["groups"]) & set(projects[b]["groups"]))


def _enforced(independent_tiers):
    return [t for t in (0, 1) if (independent_tiers >> t) & 1]


def _independent(projects, tier):
    """The first pairwise-unrelated triple in index order, else the largest such set's size."""
    n = len(tier)
    count = min(n, 1)
    for i in range(n):
        for j in range(i + 1, n):
            if _related(projects, tier[i], tier[j]):
                continue
            count = max(count, 2)
            for k in range(j + 1, n):
                if not _related(projects, tier[i], tier[k]) and not _related(projects, tier[j], tier[k]):
                    return [tier[i], tier[j], tier[k]], 3
    return None, count


def check_ballot(ballot, projects, pool, independent_tiers):
    if not _readable(ballot, len(projects)):
        return {"ok": False, "errors": [{"rule": "shape"}], "proof": []}
    errors = []
    groups = tiers_of(ballot)
    if len(groups) > 3:
        errors.append({"rule": "tiers"})

    def total(xs):
        return sum(projects[i]["askUsd"] for i in xs)

    requested = total([i for g in groups for i in g])
    if 2 * requested < 3 * pool:
        errors.append({"rule": "size", "requested": requested, "needed": (3 * pool + 1) // 2, "pool": pool})
    proof = []
    for t in _enforced(independent_tiers):
        tier = groups[t] if t < len(groups) else []
        found, count = _independent(projects, tier)
        by_group = {}
        for i in tier:
            for g in projects[i]["groups"]:
                by_group.setdefault(g, []).append(i)
        ids = sorted(by_group)
        if found:
            proof += found
        else:
            errors.append({
                "rule": "independent",
                "tier": t,
                "count": count,
                "related": [{"group": g, "projects": by_group[g]} for g in ids if len(by_group[g]) >= 2],
            })
        tier_usd = total(tier)
        for g in ids:
            group_usd = total(by_group[g])
            if 2 * group_usd > tier_usd:
                errors.append({"rule": "group", "tier": t, "group": g, "groupUsd": group_usd, "tierUsd": tier_usd})
    if errors:
        return {"ok": False, "errors": errors, "proof": []}
    return {"ok": True, "errors": [], "proof": proof}


def check_proof(ballot, projects, independent_tiers, proof):
    """Whether `proof` names, per enforced tier in order, three pairwise-unrelated projects in it."""
    tiers = _enforced(independent_tiers)
    if len(proof) != 3 * len(tiers):
        return False
    groups = tiers_of(ballot)
    for k, t in enumerate(tiers):
        a, b, c = proof[3 * k : 3 * k + 3]
        tier = set(groups[t]) if t < len(groups) else set()
        if not {a, b, c} <= tier or len({a, b, c}) < 3:
            return False
        if _related(projects, a, b) or _related(projects, a, c) or _related(projects, b, c):
            return False
    return True
