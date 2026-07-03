"""Seed the board with the real candidate RFPs (June 2026 list).

Run once: .venv/bin/python seed.py
Only seeds an empty database; never duplicates. Goals are placeholders for
Griff to refine in the admin panel.
"""
import db

RFPS = [
    ("Vyper compiler formal verification",
     "Formally verify the Vyper compiler so that contracts compiled with it "
     "carry mathematical correctness guarantees. Vyper is about 99% done on "
     "its language semantics and is the furthest-along verified compiler in "
     "the space, with Curve as the anchor user.",
     450_000, True),
    ("Automated EIP compliance for client teams",
     "Package and integrate PRSpec into the staging pipelines of Ethereum "
     "client teams, so every release can be automatically checked for strict "
     "alignment with the EIPs before it reaches production. It runs locally "
     "to keep the compute cost off the teams, with the goal of becoming a "
     "standard pre-release check across the major clients.",
     12_500, False),
    ("RWA asset risk assessment",
     "Risk-assess a basket of tokenized real-world assets (tokenized stocks, "
     "Pax Gold, Tether Gold, and similar) so lending markets like AAVE and "
     "Morpho can rely on them more safely. Proposed by Particula.",
     250_000, False),
    ("OPSEC rating agency, an \"L2Beat for OPSEC\"",
     "A public site that rates and compares the operational security of "
     "teams and protocols, covering things like multisig setup and key "
     "management, with something like AAA ratings so the ecosystem can see "
     "who is doing it well.",
     300_000, False),
    ("White hat insurance",
     "Bootstrap a model for insuring projects for white hat bounty payouts. "
     "It is like a bug bounty program but with more checks and balances.",
     200_000, False),
    ("Anonymous local dapp client",
     "A privacy-focused browser you run locally on your computer that allows "
     "you to interact with smart contracts directly, almost like Mist back "
     "in the day.",
     400_000, False),
    ("Security tooling built into the browser",
     "Bundle wallet-drain protections into a browser like Brave out of the "
     "box, so every user gets that protection for free without needing to "
     "download anything.",
     250_000, False),
]


def main():
    db.init()
    if db.list_rfps(("pending", "approved", "rejected", "archived")):
        print("Database already has RFPs; not seeding.")
        return
    for title, summary, goal, featured in RFPS:
        rfp_id, slug = db.create_rfp(title, summary, "", goal, [], "",
                                     status="approved")
        if featured:
            db.update_rfp(rfp_id, featured=1)
        print("seeded: %s (/rfp/%s, $%s goal)" % (title, slug, goal))
    print("Done — %d RFPs live." % len(RFPS))


if __name__ == "__main__":
    main()
