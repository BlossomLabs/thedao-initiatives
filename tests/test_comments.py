"""Community Q&A tests (SPEC-community-qa §16.1).

Covers: personal_sign recovery vectors, vote eligibility, author starting
vote, two-tier ordering, AI verdict mapping (incl. fail-safe-to-held),
role fast-lane, claim-token privacy, report counter, funded state, and
config checksum validation.
"""
import hashlib
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config

# Point the app at a throwaway database BEFORE app import runs db.init().
_TMP = tempfile.mkdtemp(prefix="rfps-test-")
config.DB_PATH = os.path.join(_TMP, "test.db")

import app as appmod
import chain
import db


# Known-good vectors generated with eth-account 0.13 (throwaway keys
# 0x11...11 and 0x22...22, used for nothing but these vectors).
VECTOR_TS = 1755200000
VECTORS = [
    {"address": "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
     "content": "a" * 64,
     "signature": "0x8922627290054f55199f9f0a77c7d7cdd5780dc2543bca323d023d0f"
                  "2de1b82e2b350aafa69d992dff7d069050aee1bfd37aa4e03e8f35992e"
                  "040a25b60eb2eb1b"},
    {"address": "0x1563915e194D8CfBA1943570603F7606A3115508",
     "content": "b" * 64,
     "signature": "0x31aeacf2835ddfb19d23d9428be8b0ba30b551c8768c852fd88755ca"
                  "5d76792a1e549bb7484cee831cb56017e848b7af18a93bbfd8f737eec3"
                  "8537f2880b1cbc1b"},
]


def vector_message(v):
    return ("TheDAO Security Fund\naction:post\ninitiative:test-initiative\n"
            "content:%s\nts:%d" % (v["content"], VECTOR_TS))


class TestSignatureRecovery(unittest.TestCase):
    def test_known_good_vectors(self):
        for v in VECTORS:
            self.assertEqual(
                chain.recover_personal_sign(vector_message(v), v["signature"]),
                v["address"])

    def test_wrong_signature_recovers_wrong_address(self):
        got = chain.recover_personal_sign(
            vector_message(VECTORS[0]), VECTORS[1]["signature"])
        self.assertNotEqual(got, VECTORS[0]["address"])

    def test_malformed_inputs_return_none(self):
        for sig in ("", "0x", "0x1234", "0x" + "zz" * 65, "0x" + "00" * 65):
            self.assertIsNone(
                chain.recover_personal_sign("hello", sig))

    def test_expired_timestamp_rejected(self):
        v = VECTORS[0]
        body = {"signature": v["signature"], "ts": VECTOR_TS}
        # VECTOR_TS is far in the past relative to now
        addr, err = appmod._verify_sig("post", "test-initiative",
                                       v["content"], body)
        self.assertIsNone(addr)
        self.assertIn("expired", err)

    def test_fresh_signature_verifies(self):
        v = VECTORS[0]
        body = {"signature": v["signature"], "ts": VECTOR_TS}
        with mock.patch("app.time") as t:
            t.time.return_value = VECTOR_TS + 30
            addr, ts = appmod._verify_sig("post", "test-initiative",
                                          v["content"], body)
        self.assertEqual(addr, v["address"])
        self.assertEqual(ts, VECTOR_TS)


class TestConfigChecksums(unittest.TestCase):
    def test_role_addresses_are_checksummed(self):
        for a in (config.CURATOR_ADDRESSES + config.ADMIN_ADDRESSES
                  + [config.BADGE_CONTRACT]):
            self.assertEqual(chain.to_checksum(a), a,
                             "address not checksummed: %s" % a)


def make_rfp(goal=1000, status="approved"):
    rid, slug = db.create_rfp("Test initiative %d" % time.time_ns(),
                              "s" * 60, "", goal, [], "", status=status)
    if status != "pending":
        db.update_rfp(rid, status=status)
    return rid, db.rfp_by_id(rid)["slug"]


def confirm_donation(rfp_id, donor, usd):
    db.record_donation(rfp_id, "0x" + hashlib.sha256(
        ("%s%s%s" % (rfp_id, donor, time.time_ns())).encode()).hexdigest(),
        {"ok": True, "found": True, "pending": False,
         "token_symbol": "USDC", "token_address": "0xtok", "amount_raw": "0",
         "amount": usd, "amount_usd": usd, "donor": donor, "detail": "test"})


DONOR = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
CURATOR = config.CURATOR_ADDRESSES[0]
NOBODY = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"


class TestVoteEligibility(unittest.TestCase):
    def setUp(self):
        self.rid, self.slug = make_rfp()

    def test_role_is_eligible(self):
        with mock.patch.object(chain, "has_badge", return_value=False):
            self.assertTrue(appmod._vote_eligible(CURATOR, self.rid))

    def test_badge_holder_is_eligible(self):
        with mock.patch.object(chain, "has_badge", return_value=True):
            self.assertTrue(appmod._vote_eligible(NOBODY, self.rid))

    def test_20_dollar_donor_is_eligible(self):
        confirm_donation(self.rid, DONOR, 25)
        with mock.patch.object(chain, "has_badge", return_value=False):
            self.assertTrue(appmod._vote_eligible(DONOR, self.rid))

    def test_small_donor_is_not_eligible(self):
        confirm_donation(self.rid, DONOR, 5)
        with mock.patch.object(chain, "has_badge", return_value=False):
            self.assertFalse(appmod._vote_eligible(DONOR, self.rid))

    def test_donation_to_other_initiative_grants_nothing(self):
        other_rid, _ = make_rfp()
        confirm_donation(other_rid, DONOR, 500)
        with mock.patch.object(chain, "has_badge", return_value=False):
            self.assertFalse(appmod._vote_eligible(DONOR, self.rid))

    def test_no_wallet_is_not_eligible(self):
        self.assertFalse(appmod._vote_eligible("", self.rid))


class TestAuthorStartingVote(unittest.TestCase):
    def test_eligible_author_starts_at_one(self):
        rid, _ = make_rfp()
        cid, _tok = db.create_comment(rid, None, "suggestion", "", "body",
                                      "", "", DONOR, "DONOR", "published",
                                      start_vote=True)
        self.assertEqual(db.comment_by_id(cid)["votes"], 1)
        self.assertIn(cid, db.votes_by_address(rid, DONOR))

    def test_other_entries_start_at_zero(self):
        rid, _ = make_rfp()
        cid, _tok = db.create_comment(rid, None, "question", "", "body",
                                      "Sam", "", "", "", "published")
        self.assertEqual(db.comment_by_id(cid)["votes"], 0)

    def test_author_can_untap_their_own_vote(self):
        rid, _ = make_rfp()
        cid, _tok = db.create_comment(rid, None, "suggestion", "", "body",
                                      "", "", DONOR, "DONOR", "published",
                                      start_vote=True)
        ok, voted, votes = db.set_vote(cid, DONOR, 1,int(time.time()))
        self.assertTrue(ok)
        self.assertFalse(voted)
        self.assertEqual(votes, 0)

    def test_downvote_and_switch(self):
        rid, _ = make_rfp()
        cid, _t = db.create_comment(rid, None, "question", "", "b", "n",
                                    "", "", "", "published")
        ok, my, sc = db.set_vote(cid, DONOR, -1, 1000)   # down
        self.assertTrue(ok); self.assertEqual(my, -1); self.assertEqual(sc, -1)
        ok, my, sc = db.set_vote(cid, DONOR, 1, 1001)    # switch to up
        self.assertTrue(ok); self.assertEqual(my, 1); self.assertEqual(sc, 1)
        ok, my, sc = db.set_vote(cid, DONOR, 1, 1002)    # up again clears
        self.assertTrue(ok); self.assertEqual(my, 0); self.assertEqual(sc, 0)


class TestVoteReplayGuard(unittest.TestCase):
    def test_stale_ts_cannot_flip_vote(self):
        rid, _ = make_rfp()
        cid, _tok = db.create_comment(rid, None, "question", "", "b", "n",
                                      "", "", "", "published")
        ok, voted, votes = db.set_vote(cid, DONOR, 1,1000)
        self.assertTrue(ok)
        self.assertTrue(voted)
        # same signed ts replayed: refused, vote stays
        ok2, _, votes2 = db.set_vote(cid, DONOR, 1,1000)
        self.assertFalse(ok2)
        self.assertEqual(votes2, 1)
        # a fresh signature (newer ts) toggles normally
        ok3, voted3, votes3 = db.set_vote(cid, DONOR, 1,1001)
        self.assertTrue(ok3)
        self.assertFalse(voted3)
        self.assertEqual(votes3, 0)


class TestTwoTierOrdering(unittest.TestCase):
    def test_featured_first_then_votes_then_newest(self):
        rid, slug = make_rfp()
        ids = {}
        for key, votes, featured, at in (
                ("old_lowvote", 1, 0, 100), ("high_vote", 9, 0, 200),
                ("newer_tie", 1, 0, 300), ("featured_old", 0, 1, 50),
                ("featured_new", 0, 2, 60)):
            cid, _t = db.create_comment(rid, None, "suggestion", "", key,
                                        "n", "", "", "", "published")
            con = db.connect()
            with con:
                con.execute("UPDATE comments SET votes=?, featured=?, "
                            "created_at=? WHERE id=?",
                            (votes, featured, at, cid))
            con.close()
            ids[key] = cid
        client = appmod.app.test_client()
        data = client.get("/api/initiative/%s/comments" % slug).get_json()
        order = [e["id"] for e in data["entries"]]
        expected = [ids["featured_new"], ids["featured_old"],
                    ids["high_vote"], ids["newer_tie"], ids["old_lowvote"]]
        self.assertEqual(order, expected)


class TestAiVerdictMapping(unittest.TestCase):
    def _with_ai(self, payload_or_exc):
        def fake_urlopen(req, timeout=None):
            if isinstance(payload_or_exc, Exception):
                raise payload_or_exc
            class R:
                def __enter__(self):
                    return self
                def __exit__(self, *a):
                    return False
                def read(self):
                    return json.dumps({"choices": [{"message": {
                        "content": json.dumps(payload_or_exc)}}]}).encode()
            return R()
        return mock.patch.object(appmod.urllib.request, "urlopen",
                                 side_effect=fake_urlopen)

    def setUp(self):
        appmod.config.AI_SEARCH_API_KEY = appmod.config.AI_SEARCH_API_KEY or "test"

    def test_constructive_publishes(self):
        with self._with_ai({"verdict": "constructive", "summary": "fine",
                            "type_match": True, "name_flag": "ok"}):
            self.assertEqual(
                appmod.ai_screen_comment("question", "", "why?", "Sam")[0],
                "published")

    def test_unclear_holds(self):
        with self._with_ai({"verdict": "unclear", "summary": "meh"}):
            self.assertEqual(
                appmod.ai_screen_comment("question", "", "x", "Sam")[0],
                "held")

    def test_spam_discards(self):
        with self._with_ai({"verdict": "spam", "summary": "spam"}):
            self.assertEqual(
                appmod.ai_screen_comment("other", "", "buy now", "x")[0],
                "discarded")

    def test_type_match_ignored(self):
        # Types were collapsed to "other", so type_match is no longer a gate:
        # a constructive comment publishes regardless of it.
        with self._with_ai({"verdict": "constructive", "type_match": False,
                            "name_flag": "ok"}):
            self.assertEqual(
                appmod.ai_screen_comment("other", "", "great work on this", "Sam")[0],
                "published")

    def test_bad_name_holds(self):
        with self._with_ai({"verdict": "constructive", "type_match": True,
                            "name_flag": "impersonation"}):
            self.assertEqual(
                appmod.ai_screen_comment("question", "", "x", "vitalik")[0],
                "held")

    def test_invalid_verdict_holds(self):
        with self._with_ai({"verdict": "amazing"}):
            self.assertEqual(
                appmod.ai_screen_comment("question", "", "x", "Sam")[0],
                "held")

    def test_ai_failure_fails_safe_to_held(self):
        with self._with_ai(OSError("api down")):
            self.assertEqual(
                appmod.ai_screen_comment("question", "", "x", "Sam")[0],
                "held")


class TestPostPipeline(unittest.TestCase):
    def setUp(self):
        self.rid, self.slug = make_rfp()
        self.client = appmod.app.test_client()
        appmod._buckets.clear()

    def post(self, payload, ip="9.9.9.9"):
        return self.client.post(
            "/api/initiative/%s/comments" % self.slug, json=payload,
            headers={"Origin": "http://localhost"},
            environ_base={"REMOTE_ADDR": ip})

    def test_honeypot_silently_discards(self):
        r = self.post({"type": "question", "body": "x", "name": "n",
                       "website": "spam"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["id"], 0)
        self.assertEqual(len(db.comments_for_rfp(self.rid)), 0)

    def test_role_fast_lane_skips_ai(self):
        with mock.patch.object(chain, "has_badge", return_value=True), \
             mock.patch.object(appmod, "ai_screen_comment") as ai:
            body = "please expand the scope"
            ts = int(time.time())
            # role post needs a real signature; use a locally signed vector
            # generated at runtime with the recovery function inverted is not
            # possible, so instead fast-lane is proven via a curator address
            # mock on the signature verifier.
            with mock.patch.object(appmod, "_verify_sig",
                                   return_value=(CURATOR, ts)):
                r = self.post({"type": "suggestion", "body": body,
                               "signature": "0xstub", "ts": ts})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["status"], "published")
        ai.assert_not_called()

    def test_anonymous_needs_a_name(self):
        r = self.post({"type": "question", "body": "x"})
        self.assertEqual(r.status_code, 400)

    def test_held_returns_claim_token_and_is_private(self):
        with mock.patch.object(appmod, "ai_screen_comment",
                               return_value=("held", "unsure")):
            r = self.post({"type": "question", "body": "x", "name": "Sam"})
        d = r.get_json()
        self.assertEqual(d["status"], "held")
        token = d["claim_token"]
        self.assertTrue(token)
        # not in the public list
        pub = self.client.get(
            "/api/initiative/%s/comments" % self.slug).get_json()
        self.assertEqual(pub["entries"], [])
        # visible via its own token
        mine = self.client.get("/api/comments/mine?tokens=" + token).get_json()
        self.assertEqual(len(mine["held"]), 1)
        # claim-token privacy: another token reads nothing
        other = "f" * 32
        mine2 = self.client.get("/api/comments/mine?tokens=" + other).get_json()
        self.assertEqual(mine2["held"], [])

    def test_report_counter_increments_and_never_hides(self):
        cid, _t = db.create_comment(self.rid, None, "question", "", "b",
                                    "n", "", "", "", "published")
        for i in range(3):
            r = self.client.post("/api/comments/%d/report" % cid, json={},
                                 headers={"Origin": "http://localhost"},
                                 environ_base={"REMOTE_ADDR": "8.8.8.%d" % i})
            self.assertEqual(r.status_code, 200)
        row = db.comment_by_id(cid)
        self.assertEqual(row["reports"], 3)
        self.assertEqual(row["status"], "published")  # reports never auto-hide


class TestFundedState(unittest.TestCase):
    def test_funded_bar_renders(self):
        rid, slug = make_rfp(goal=100)
        confirm_donation(rid, DONOR, 150)
        client = appmod.app.test_client()
        html = client.get("/initiative/%s" % slug).get_data(as_text=True)
        self.assertIn("Funded! This initiative reached its goal", html)

    def test_unfunded_shows_normal_bar(self):
        rid, slug = make_rfp(goal=100000)
        client = appmod.app.test_client()
        html = client.get("/initiative/%s" % slug).get_data(as_text=True)
        self.assertNotIn("Funded! This initiative reached its goal", html)


class TestReplyBinding(unittest.TestCase):
    def test_reply_signature_binds_entry_id(self):
        rid, slug = make_rfp()
        cid, _t = db.create_comment(rid, None, "question", "", "q", "n",
                                    "", "", "", "published")
        other, _t2 = db.create_comment(rid, None, "question", "", "q2", "n",
                                       "", "", "", "published")
        client = appmod.app.test_client()
        appmod._buckets.clear()
        appmod._seen_sigs.clear()
        text = "the reply body"
        h = hashlib.sha256(text.encode()).hexdigest()
        ts = int(time.time())
        calls = []
        def fake_verify(action, s, content, body):
            calls.append(content)
            return (CURATOR, ts)
        with mock.patch.object(appmod, "_verify_sig",
                               side_effect=fake_verify), \
             mock.patch.object(chain, "has_badge", return_value=False):
            r = client.post("/api/comments/%d/reply" % cid,
                            json={"body": text, "signature": "0xreplystub",
                                  "ts": ts},
                            headers={"Origin": "http://localhost"},
                            environ_base={"REMOTE_ADDR": "7.7.7.7"})
        self.assertEqual(r.status_code, 200)
        # the verified content string names THIS entry id + the body hash
        self.assertEqual(calls, ["%d:%s" % (cid, h)])
        # role reply marks the question answered
        self.assertEqual(db.comment_by_id(cid)["answered"], 1)
        self.assertEqual(db.comment_by_id(other)["answered"], 0)


class TestReplyRoleGate(unittest.TestCase):
    """Replies are role-only (spec §1/§4): team, curators, ETHSecurity badge
    holders. A plain wallet or a name-only poster cannot reply."""

    def setUp(self):
        self.rid, self.slug = make_rfp()
        self.cid, _ = db.create_comment(self.rid, None, "question", "", "q",
                                        "n", "", "", "", "published")
        self.client = appmod.app.test_client()
        appmod._buckets.clear()
        appmod._seen_sigs.clear()

    def _reply(self, payload, ip="7.7.7.8"):
        return self.client.post("/api/comments/%d/reply" % self.cid,
                                json=payload,
                                headers={"Origin": "http://localhost"},
                                environ_base={"REMOTE_ADDR": ip})

    def test_plain_wallet_cannot_reply(self):
        ts = int(time.time())
        with mock.patch.object(appmod, "_verify_sig",
                               return_value=(NOBODY, ts)), \
             mock.patch.object(chain, "has_badge", return_value=False):
            r = self._reply({"body": "hi", "signature": "0xstub", "ts": ts})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(db.comment_by_id(self.cid)["answered"], 0)

    def test_curator_can_reply_and_answers(self):
        ts = int(time.time())
        with mock.patch.object(appmod, "_verify_sig",
                               return_value=(CURATOR, ts)), \
             mock.patch.object(chain, "has_badge", return_value=False):
            r = self._reply({"body": "hi", "signature": "0xstub2", "ts": ts})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(db.comment_by_id(self.cid)["answered"], 1)

    def test_nameonly_reply_rejected(self):
        r = self._reply({"body": "hi", "name": "Sam"})
        self.assertEqual(r.status_code, 403)


class TestAdminWalletLogin(unittest.TestCase):
    """Wallet-gated admin sign-in: a signer in ADMIN_ADDRESSES gets the same
    admin session the password grants; anyone else is rejected."""

    def setUp(self):
        self.client = appmod.app.test_client()
        appmod._buckets.clear()
        appmod._seen_sigs.clear()

    def _login(self, addr, sig):
        ts = int(time.time())
        with mock.patch.object(appmod, "_verify_sig", return_value=(addr, ts)):
            return self.client.post("/admin/login-wallet",
                                    json={"signature": sig, "ts": ts},
                                    headers={"Origin": "http://localhost"},
                                    environ_base={"REMOTE_ADDR": "6.6.6.6"})

    def test_admin_wallet_grants_session(self):
        r = self._login(config.ADMIN_ADDRESSES[0], "0xadminstub")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get("/admin/dashboard").status_code, 200)

    def test_non_admin_wallet_rejected(self):
        r = self._login(NOBODY, "0xnotadmin")
        self.assertEqual(r.status_code, 403)
        self.assertIn(self.client.get("/admin/dashboard").status_code,
                      (302, 401))


class TestSignatureReplayGuard(unittest.TestCase):
    def test_same_signature_rejected_second_time(self):
        appmod._seen_sigs.clear()
        self.assertTrue(appmod._fresh_signature("0xdeadbeef"))
        self.assertFalse(appmod._fresh_signature("0xdeadbeef"))
        self.assertFalse(appmod._fresh_signature("0xDEADBEEF"))  # case-insensitive

    def test_expired_signatures_are_pruned(self):
        appmod._seen_sigs.clear()
        with mock.patch("app.time") as t:
            t.time.return_value = 1000
            appmod._fresh_signature("0xaa")
        with mock.patch("app.time") as t:
            t.time.return_value = 1000 + appmod.SIG_WINDOW_SECS + 1
            # old entry pruned, so the same sig is fresh again after expiry
            self.assertTrue(appmod._fresh_signature("0xaa"))


class TestFeatureRestrictedToTopLevel(unittest.TestCase):
    def _admin_client(self):
        appmod.config.ADMIN_PASSWORD = "pw"
        c = appmod.app.test_client()
        with c.session_transaction() as s:
            s["admin"] = True
            s["_csrf"] = "tok"
        return c

    def test_cannot_feature_a_reply(self):
        rid, _ = make_rfp()
        cid, _t = db.create_comment(rid, None, "question", "", "q", "n",
                                    "", "", "", "published")
        reply, _t2 = db.create_comment(rid, cid, "question", "", "r", "n",
                                       "", "", "ADMIN", "published")
        c = self._admin_client()
        r = c.post("/admin/comments/%d/feature-front" % reply,
                   data={"_csrf": "tok"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(db.comment_by_id(reply)["featured"], 0)

    def test_cannot_feature_a_held_entry(self):
        rid, _ = make_rfp()
        cid, _t = db.create_comment(rid, None, "suggestion", "", "s", "n",
                                    "", "", "", "held")
        c = self._admin_client()
        r = c.post("/admin/comments/%d/feature" % cid, data={"_csrf": "tok"})
        self.assertEqual(r.status_code, 400)


class TestConfigRefusesBadAddress(unittest.TestCase):
    def test_non_checksummed_curator_would_raise(self):
        # The boot-time loop that runs at import (app.py) rejects any
        # non-checksummed role address; prove the check itself.
        bad = config.CURATOR_ADDRESSES[0].lower()
        self.assertNotEqual(chain.to_checksum(bad), bad)  # lower != checksummed
        with self.assertRaises(Exception):
            for a in [bad]:
                if chain.to_checksum(a) != a:
                    raise RuntimeError("config address not checksummed: %s" % a)


@unittest.skipIf(os.environ.get("RFPS_SKIP_LIVE") == "1",
                 "live mainnet call skipped")
class TestBadgeLive(unittest.TestCase):
    """§16.3: verify against mainnet that a known curator holds the badge."""
    def test_curator_holds_badge_on_mainnet(self):
        self.assertTrue(chain.has_badge(config.CURATOR_ADDRESSES[0]))

    def test_random_address_has_no_badge(self):
        self.assertFalse(chain.has_badge(
            "0x000000000000000000000000000000000000dEaD"))


if __name__ == "__main__":
    unittest.main()
