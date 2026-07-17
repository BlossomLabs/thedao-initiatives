"""Tests for the fund-critical logic. Run: python3 -m unittest discover tests -v

Everything here guards money paths: keccak constants, address checksumming,
Transfer-log verification (synthetic receipts + real mainnet ground truth),
Safe deploy encoding/verification, pricing guards, and donation bookkeeping.
"""
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chain
import config


def chainlink_round(answer, updated_at=None):
    """Encode a Chainlink latestRoundData() return blob:
    (roundId, answer, startedAt, updatedAt, answeredInRound). updatedAt defaults
    to now so the staleness guard in usd_rate() passes."""
    if updated_at is None:
        updated_at = int(time.time())
    words = [1, answer, updated_at, updated_at, 1]
    mask = (1 << 256) - 1
    return "0x" + b"".join((w & mask).to_bytes(32, "big") for w in words).hex()


class TestKeccakConstants(unittest.TestCase):
    """The hardcoded selectors/topics must equal freshly computed keccak."""

    def test_transfer_event_topic(self):
        computed = "0x" + chain.keccak256(
            b"Transfer(address,address,uint256)").hex()
        self.assertEqual(computed, chain.TRANSFER_TOPIC)

    def test_transfer_function_selector(self):
        computed = chain.keccak256(b"transfer(address,uint256)")[:4].hex()
        self.assertEqual(computed, "a9059cbb")  # used by client-side encoder

    def test_decimals_selector(self):
        self.assertEqual(chain.keccak256(b"decimals()")[:4].hex(), "313ce567")

    def test_symbol_selector(self):
        self.assertEqual(chain.keccak256(b"symbol()")[:4].hex(), "95d89b41")

    def test_transfer_calldata_vector(self):
        """Mirror of static/app.js transferCalldata(): keep in lockstep."""
        to = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780"
        amount = 250_000_000  # 250 USDC (6 decimals)
        expected = ("0xa9059cbb"
                    + "000000000000000000000000"
                    + to[2:].lower()
                    + hex(amount)[2:].rjust(64, "0"))
        built = ("0xa9059cbb"
                 + to[2:].lower().rjust(64, "0")
                 + hex(amount)[2:].rjust(64, "0"))
        self.assertEqual(built, expected)
        self.assertEqual(len(built), 2 + 8 + 64 + 64)


class TestChecksum(unittest.TestCase):
    def test_eip55_reference_vectors(self):
        # Official EIP-55 test vectors.
        vectors = [
            "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
            "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
            "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
            "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
        ]
        for v in vectors:
            self.assertEqual(chain.to_checksum(v.lower()), v)

    def test_config_tokens_are_checksummed(self):
        for sym, (addr, _) in config.TOKENS.items():
            self.assertEqual(chain.to_checksum(addr), addr,
                             "config address for %s is not checksummed" % sym)

    def test_rejects_garbage(self):
        for bad in ["0x123", "", "0x" + "g" * 40, "hello"]:
            self.assertFalse(chain.is_address(bad))


def _fake_receipt(status, logs):
    return {"status": status, "logs": logs}


def _transfer_log(token, sender, recipient, raw_amount):
    return {
        "address": token,
        "topics": [
            chain.TRANSFER_TOPIC,
            "0x" + "0" * 24 + sender.lower().replace("0x", ""),
            "0x" + "0" * 24 + recipient.lower().replace("0x", ""),
        ],
        "data": hex(raw_amount),
    }


SAFE = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780"  # a donation recipient (an RFP Safe)
DONOR = "0x1111111111111111111111111111111111111111"
USDC = config.TOKENS["USDC"][0]
DAI = config.TOKENS["DAI"][0]


class TestVerifyDonation(unittest.TestCase):
    def _verify(self, receipt, tx=None):
        def fake_rpc(method, params, timeout=10):
            if method == "eth_getTransactionReceipt":
                return receipt
            if method == "eth_getTransactionByHash":
                return tx
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            return chain.verify_donation_tx(
                "0x" + "ab" * 32, SAFE, config.TOKENS)

    def test_valid_usdc_transfer(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, SAFE, 250_000_000)]))  # 250 USDC
        self.assertTrue(r["ok"])
        self.assertEqual(r["token_symbol"], "USDC")
        self.assertEqual(r["amount"], 250.0)
        self.assertEqual(r["donor"].lower(), DONOR.lower())

    def test_valid_dai_transfer_18_decimals(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(DAI, DONOR, SAFE, 42 * 10 ** 18)]))
        self.assertTrue(r["ok"])
        self.assertEqual(r["token_symbol"], "DAI")
        self.assertEqual(r["amount"], 42.0)

    def test_rejects_transfer_to_wrong_recipient(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, DONOR, 250_000_000)]))
        self.assertFalse(r["ok"])

    def test_rejects_unknown_token(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log("0x2222222222222222222222222222222222222222",
                          DONOR, SAFE, 10 ** 18)]))
        self.assertFalse(r["ok"])

    def test_rejects_reverted_tx(self):
        r = self._verify(_fake_receipt("0x0", [
            _transfer_log(USDC, DONOR, SAFE, 250_000_000)]))
        self.assertFalse(r["ok"])
        self.assertIn("reverted", r["detail"])

    def test_rejects_zero_amount(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, SAFE, 0)]))
        self.assertFalse(r["ok"])

    def test_pending_tx(self):
        r = self._verify(None, tx={"hash": "0x" + "ab" * 32})
        self.assertFalse(r["ok"])
        self.assertTrue(r["pending"])

    def test_not_found(self):
        r = self._verify(None, tx=None)
        self.assertFalse(r["ok"])
        self.assertFalse(r["found"])

    def test_malformed_hash(self):
        r = chain.verify_donation_tx("nonsense", SAFE, config.TOKENS)
        self.assertFalse(r["ok"])
        self.assertIn("malformed", r["detail"])

    def test_picks_safe_transfer_among_many_logs(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, DONOR, 999),
            _transfer_log(DAI, DONOR, SAFE, 7 * 10 ** 18),
            _transfer_log(USDC, DONOR, DONOR, 999),
        ]))
        self.assertTrue(r["ok"])
        self.assertEqual(r["token_symbol"], "DAI")
        self.assertEqual(r["amount"], 7.0)

    def test_sums_multiple_transfers_of_same_token(self):
        # a batched/multicall donation moving the token to the Safe twice
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, SAFE, 100_000_000),
            _transfer_log(USDC, DONOR, SAFE, 150_000_000),
        ]))
        self.assertTrue(r["ok"])
        self.assertEqual(r["amount"], 250.0)

    def test_rejects_dust_below_one_token(self):
        # 0.5 USDC is below the 1-token dust floor
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, SAFE, 500_000)]))
        self.assertFalse(r["ok"])
        self.assertIn("minimum", r["detail"])

    def test_confirmation_depth_pending_when_too_shallow(self):
        # receipt is mined at block 100; head is also 100 -> depth 1 < 2
        receipt = {"status": "0x1", "blockNumber": hex(100),
                   "logs": [_transfer_log(USDC, DONOR, SAFE, 250_000_000)]}

        def fake_rpc(method, params, timeout=10):
            if method == "eth_getTransactionReceipt":
                return receipt
            if method == "eth_blockNumber":
                return hex(100)
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            r = chain.verify_donation_tx("0x" + "ab" * 32, SAFE,
                                         config.TOKENS)
        self.assertFalse(r["ok"])
        self.assertTrue(r["pending"])

    def test_confirmation_depth_ok_when_deep_enough(self):
        receipt = {"status": "0x1", "blockNumber": hex(100),
                   "logs": [_transfer_log(USDC, DONOR, SAFE, 250_000_000)]}

        def fake_rpc(method, params, timeout=10):
            if method == "eth_getTransactionReceipt":
                return receipt
            if method == "eth_blockNumber":
                return hex(105)  # 6 confirmations
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            r = chain.verify_donation_tx("0x" + "ab" * 32, SAFE,
                                         config.TOKENS)
        self.assertTrue(r["ok"])
        self.assertEqual(r["amount"], 250.0)


class TestLiveChain(unittest.TestCase):
    """Live mainnet checks. Skipped when RFPS_SKIP_LIVE=1."""

    @unittest.skipIf(os.environ.get("RFPS_SKIP_LIVE") == "1", "live disabled")
    def test_token_verification_against_mainnet(self):
        results = chain.verify_tokens()
        for sym, entry in results.items():
            self.assertTrue(entry["ok"],
                            "%s failed on-chain check: %s" % (sym, entry["detail"]))

SIGNERS = [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444",
    "0x5555555555555555555555555555555555555555",
]
SIGNERS = [chain.to_checksum(a) for a in SIGNERS]


class TestSafeDeploy(unittest.TestCase):
    def test_selectors_are_wellknown(self):
        # cross-check the keccak-derived selectors against published values
        self.assertEqual(chain.SEL_CREATE_PROXY, "0x1688f0b9")
        self.assertEqual(chain.SEL_SETUP, "0xb63e800d")
        self.assertEqual(chain.SEL_GET_OWNERS, "0xa0e67e2b")
        self.assertEqual(chain.SEL_GET_THRESHOLD, "0xe75235b8")

    def test_setup_encoding_layout(self):
        blob = chain.encode_safe_setup(SIGNERS, 3, config.SAFE_FALLBACK_HANDLER)
        self.assertEqual(blob[:4].hex(), "b63e800d")
        args = blob[4:]
        # head word 0: offset to owners array = 8 words = 0x100
        self.assertEqual(int.from_bytes(args[0:32], "big"), 8 * 32)
        # head word 1: threshold
        self.assertEqual(int.from_bytes(args[32:64], "big"), 3)
        # owners tail: length then the 5 addresses
        off = 8 * 32
        self.assertEqual(int.from_bytes(args[off:off + 32], "big"), 5)
        first = "0x" + args[off + 32 + 12:off + 64].hex()
        self.assertEqual(first.lower(), SIGNERS[0].lower())
        # data offset (head word 3) points just past the owners tail
        data_off = int.from_bytes(args[96:128], "big")
        self.assertEqual(data_off, 8 * 32 + 32 + 5 * 32)
        # and the bytes there are empty (length 0)
        self.assertEqual(int.from_bytes(args[data_off:data_off + 32], "big"), 0)

    def test_create_proxy_encoding(self):
        init = chain.encode_safe_setup(SIGNERS, 3, config.SAFE_FALLBACK_HANDLER)
        data = chain.encode_create_proxy(config.SAFE_SINGLETON, init, 42)
        raw = bytes.fromhex(data[2:])
        self.assertEqual(raw[:4].hex(), "1688f0b9")
        args = raw[4:]
        # singleton in word 0, salt nonce in word 2
        self.assertEqual("0x" + args[12:32].hex(),
                         config.SAFE_SINGLETON.lower())
        self.assertEqual(int.from_bytes(args[64:96], "big"), 42)
        # initializer bytes at the offset in word 1, length matches
        off = int.from_bytes(args[32:64], "big")
        ln = int.from_bytes(args[off:off + 32], "big")
        self.assertEqual(ln, len(init))
        self.assertEqual(args[off + 32:off + 32 + ln], init)

    def test_proxy_creation_topic(self):
        # keccak("ProxyCreation(address,address)") — published constant
        self.assertEqual(
            chain.TOPIC_PROXY_CREATION,
            "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235")

    def test_extract_deployed_safe(self):
        proxy = "0xAbcDabCDabcdAbCdAbCdABCDabcDABcDABCDabCD"
        receipt = {"status": "0x1", "logs": [{
            "address": config.SAFE_PROXY_FACTORY.lower(),
            "topics": [chain.TOPIC_PROXY_CREATION,
                       "0x" + "0" * 24 + proxy.lower().replace("0x", "")],
            "data": "0x",
        }]}

        def fake_rpc(method, params, timeout=10, endpoints=None):
            if method == "eth_getTransactionReceipt":
                return receipt
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            addr, err = chain.extract_deployed_safe("0x" + "ab" * 32)
        self.assertIsNone(err)
        self.assertEqual(addr.lower(), proxy.lower())

    def test_extract_ignores_events_from_other_contracts(self):
        receipt = {"status": "0x1", "logs": [{
            "address": "0x9999999999999999999999999999999999999999",
            "topics": [chain.TOPIC_PROXY_CREATION,
                       "0x" + "0" * 24 + "11" * 20],
            "data": "0x",
        }]}

        def fake_rpc(method, params, timeout=10, endpoints=None):
            return receipt
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            addr, err = chain.extract_deployed_safe("0x" + "ab" * 32)
        self.assertIsNone(addr)
        self.assertIn("no ProxyCreation", err)

    def test_verify_safe_owner_set(self):
        def encoded_owners(addrs):
            blob = (32).to_bytes(32, "big") + len(addrs).to_bytes(32, "big")
            for a in addrs:
                blob += bytes(12) + bytes.fromhex(a[2:].lower())
            return "0x" + blob.hex()

        calls = {
            chain.SEL_GET_THRESHOLD: "0x" + hex(3)[2:].rjust(64, "0"),
            chain.SEL_GET_OWNERS: encoded_owners(SIGNERS),
        }

        fb_slot = "0x" + chain.keccak256(
            b"fallback_manager.handler.address").hex()

        def fake_rpc(method, params, timeout=10, endpoints=None):
            if method == "eth_call":
                return calls[params[0]["data"]]
            if method == "eth_getStorageAt":
                if params[1] == fb_slot:
                    return "0x" + "0" * 24 + \
                        config.SAFE_FALLBACK_HANDLER[2:].lower()
                return "0x" + "0" * 24 + config.SAFE_SINGLETON[2:].lower()
            raise AssertionError("unexpected rpc %s" % method)

        with mock.patch.object(config, "OPERATIONAL_SIGNERS", SIGNERS), \
             mock.patch.object(chain, "rpc_call", fake_rpc):
            ok, detail = chain.verify_safe("0x" + "aa" * 20)
            self.assertTrue(ok, detail)

        # wrong owner set must be rejected
        bad = SIGNERS[:4] + ["0x9999999999999999999999999999999999999999"]
        calls[chain.SEL_GET_OWNERS] = encoded_owners(bad)
        with mock.patch.object(config, "OPERATIONAL_SIGNERS", SIGNERS), \
             mock.patch.object(chain, "rpc_call", fake_rpc):
            ok, detail = chain.verify_safe("0x" + "aa" * 20)
            self.assertFalse(ok)
            self.assertIn("mismatch", detail)

    def test_signers_configured_validation(self):
        with mock.patch.object(config, "OPERATIONAL_SIGNERS", SIGNERS):
            ok, _ = chain.signers_configured()
            self.assertTrue(ok)
        with mock.patch.object(config, "OPERATIONAL_SIGNERS", SIGNERS[:4]):
            ok, why = chain.signers_configured()
            self.assertFalse(ok)
        with mock.patch.object(config, "OPERATIONAL_SIGNERS",
                               SIGNERS[:4] + [SIGNERS[0]]):
            ok, why = chain.signers_configured()
            self.assertFalse(ok)
            self.assertIn("duplicate", why)
        # lowercase (non-checksummed) signer must be rejected; use an address
        # with letters so lowercase differs from its checksum form
        with mock.patch.object(config, "OPERATIONAL_SIGNERS",
                               SIGNERS[:4] + [config.SAFE_FALLBACK_HANDLER.lower()]):
            ok, why = chain.signers_configured()
            self.assertFalse(ok)
            self.assertIn("checksum", why)


if __name__ == "__main__":
    unittest.main()


class TestOnrampLink(unittest.TestCase):
    SAFE = "0xD5Cf05f24727C83976652E3586c0e26DD39884e9"

    def _link(self, provider, key):
        import app as app_mod
        with mock.patch.object(config, "ONRAMP_PROVIDER", provider), \
             mock.patch.object(config, "ONRAMP_API_KEY", key):
            return app_mod.onramp_link(self.SAFE)

    def test_no_key_means_no_card_option(self):
        url, prefilled = self._link("transak", "")
        self.assertFalse(prefilled)
        self.assertEqual(url, "")

    def test_transak_with_key_prefills_address(self):
        url, prefilled = self._link("transak", "pk_test_123")
        self.assertTrue(prefilled)
        self.assertIn("walletAddress=" + self.SAFE, url)
        self.assertIn("cryptoCurrencyCode=USDC", url)
        self.assertIn("network=ethereum", url)
        self.assertIn("{AMT}", url)

    def test_moonpay_with_key_prefills_address(self):
        url, prefilled = self._link("moonpay", "pk_live_x")
        self.assertTrue(prefilled)
        self.assertIn("walletAddress=" + self.SAFE, url)
        self.assertIn("currencyCode=usdc", url)
        self.assertIn("{AMT}", url)


class TestUsdRate(unittest.TestCase):
    def setUp(self):
        chain._rate_cache.clear()

    def test_usd_stables_are_exactly_one(self):
        for sym in ("USDC", "USDT", "DAI", "USDS", "crvUSD", "BOLD", "fxUSD"):
            self.assertEqual(chain.usd_rate(sym), 1.0)

    def test_feed_tokens_use_chainlink(self):
        def fake_rpc(method, params, timeout=10, endpoints=None):
            assert method == "eth_call"
            assert params[0]["to"] == config.CHAINLINK_FEEDS["EURC"]
            return chainlink_round(114_300_000)  # 1.143 with 8 decimals
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            self.assertAlmostEqual(chain.usd_rate("EURC"), 1.143)

    def test_insane_feed_value_raises(self):
        def fake_rpc(method, params, timeout=10, endpoints=None):
            return chainlink_round(1)  # 0.00000001 USD: out of sane range
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            with self.assertRaises(chain.RpcError):
                chain.usd_rate("ZCHF")

    def test_stale_feed_raises(self):
        old = int(time.time()) - chain.RATE_MAX_STALENESS - 3600

        def fake_rpc(method, params, timeout=10, endpoints=None):
            return chainlink_round(114_300_000, updated_at=old)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            with self.assertRaises(chain.RpcError):
                chain.usd_rate("EURC")

    def test_incomplete_round_raises(self):
        def fake_rpc(method, params, timeout=10, endpoints=None):
            return chainlink_round(114_300_000, updated_at=0)  # never updated
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            with self.assertRaises(chain.RpcError):
                chain.usd_rate("EURC")


class TestNativeEthDonation(unittest.TestCase):
    def setUp(self):
        chain._rate_cache.clear()

    def _verify(self, tx_value_wei, tx_to=SAFE):
        receipt = {"status": "0x1", "blockNumber": hex(100), "logs": []}
        tx = {"to": tx_to, "from": DONOR, "value": hex(tx_value_wei)}

        def fake_rpc(method, params, timeout=10, endpoints=None):
            if method == "eth_getTransactionReceipt":
                return receipt
            if method == "eth_getTransactionByHash":
                return tx
            if method == "eth_blockNumber":
                return hex(110)
            if method == "eth_call":  # ETH/USD feed (latestRoundData)
                return chainlink_round(int(1769 * 1e8))
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            return chain.verify_donation_tx("0x" + "cd" * 32, SAFE,
                                            config.TOKENS)

    def test_plain_eth_send_credits_usd_value(self):
        r = self._verify(10 ** 18)  # 1 ETH
        self.assertTrue(r["ok"])
        self.assertEqual(r["token_symbol"], "ETH")
        self.assertEqual(r["amount"], 1.0)
        self.assertAlmostEqual(r["amount_usd"], 1769.0, places=1)
        self.assertEqual(r["donor"].lower(), DONOR.lower())

    def test_eth_to_wrong_recipient_rejected(self):
        r = self._verify(10 ** 18, tx_to=DONOR)
        self.assertFalse(r["ok"])

    def test_eth_dust_rejected(self):
        r = self._verify(10 ** 12)  # 0.000001 ETH
        self.assertFalse(r["ok"])
        self.assertIn("minimum", r["detail"])


class TestBoardOrdering(unittest.TestCase):
    def _card(self, rank, total, created):
        return {"rfp": {"sort_rank": rank, "created_at": created},
                "sum": {"total": total}}

    def test_pinned_first_then_money_then_newest(self):
        import app as app_mod
        a = self._card(None, 500, 100)   # money leader
        b = self._card(2, 0, 50)         # pinned #2
        c = self._card(1, 0, 10)         # pinned #1
        d = self._card(None, 500, 200)   # money tie, newer
        e = self._card(None, 10, 300)
        ordered = app_mod.order_cards([a, b, c, d, e])
        self.assertEqual(ordered, [c, b, d, a, e])


class TestAiSearch(unittest.TestCase):
    """The LLM's output is untrusted; only validated ids may reorder the board."""

    def test_top_k_is_ten_percent_min_three(self):
        import app as app_mod
        # 10% of the board, floor of 3, but never more than the board holds
        for n, k in ((1, 1), (2, 2), (3, 3), (5, 3), (10, 3), (13, 3),
                     (30, 3), (40, 4), (100, 10)):
            self.assertEqual(app_mod.ai_top_k(n), k, "n=%d" % n)

    def test_filter_rejects_unknown_and_junk_ids(self):
        import app as app_mod
        known = {1, 2, 3, 4}
        # unknown id 99, junk types, and a duplicate are all dropped;
        # order is the model's, capped at k
        ranked = [99, "2", 2, None, "x", 4, 1, 3]
        self.assertEqual(app_mod.ai_filter_ranked(ranked, known, 2), [2, 4])
        self.assertEqual(app_mod.ai_filter_ranked(ranked, known, 10),
                         [2, 4, 1, 3])
        self.assertEqual(app_mod.ai_filter_ranked([], known, 3), [])
        self.assertEqual(app_mod.ai_filter_ranked(["evil"], known, 3), [])

    def test_daily_call_cap_blocks_then_resets_next_day(self):
        import app as app_mod
        with mock.patch.object(app_mod, "AI_DAILY_CALL_CAP", 2), \
             mock.patch.dict(app_mod._ai_daily, {"day": "", "calls": 0}):
            self.assertTrue(app_mod._ai_budget_ok())
            self.assertTrue(app_mod._ai_budget_ok())
            self.assertFalse(app_mod._ai_budget_ok())  # cap reached
            # a new day resets the counter
            app_mod._ai_daily["day"] = "1999-01-01"
            self.assertTrue(app_mod._ai_budget_ok())


class TestContentSync(unittest.TestCase):
    """content/rfps/*.md publish RFPs: files own words + goal, the admin
    panel owns lifecycle and money. Uses a throwaway DB + content dir."""

    GOOD = ("---\n"
            "title: Test initiative\n"
            "goal: $250,000\n"
            "summary: First line\n"
            "  continued line\n"
            "forum: https://forum.example.org/t/x/1\n"
            "---\n# Details\n\nSome **markdown**.")

    def setUp(self):
        import tempfile
        self._dir = tempfile.mkdtemp()
        self._db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._db.close()
        self._patches = [
            mock.patch.object(config, "BASE_DIR", self._dir),
            mock.patch.object(config, "DB_PATH", self._db.name),
        ]
        for p in self._patches:
            p.start()
        import db
        db.init()
        self.db = db
        os.makedirs(os.path.join(self._dir, "content", "rfps"))

    def tearDown(self):
        for p in self._patches:
            p.stop()
        os.unlink(self._db.name)

    def _write(self, name, text):
        with open(os.path.join(self._dir, "content", "rfps", name), "w") as f:
            f.write(text)

    def test_parser_happy_path(self):
        import app as app_mod
        f = app_mod.parse_rfp_file(self.GOOD)
        self.assertEqual(f["title"], "Test initiative")
        self.assertEqual(f["goal"], 250000.0)
        self.assertEqual(f["summary"], "First line continued line")
        self.assertEqual(f["status"], "approved")
        self.assertIn("**markdown**", f["details"])

    def test_parser_rejects_bad_files(self):
        import app as app_mod
        for bad in ("no frontmatter at all",
                    "---\ngoal: 100\n---\nbody",          # no title
                    "---\ntitle: x\ngoal: nope\n---\n",    # bad goal
                    "---\ntitle: x\ngoal: 5\nstatus: live\n---\n"):
            with self.assertRaises(ValueError):
                app_mod.parse_rfp_file(bad)

    def test_sync_creates_then_updates_without_touching_lifecycle(self):
        import app as app_mod
        self._write("test-initiative.md", self.GOOD)
        self.assertEqual(app_mod.sync_content(), (1, 0, []))
        r = self.db.rfp_by_slug("test-initiative")
        self.assertEqual(r["status"], "approved")
        self.assertEqual(r["funding_goal_usd"], 250000.0)

        # simulate launch-time state the file must never clobber
        self.db.update_rfp(r["id"], status="archived",
                           safe_address="0x" + "aa" * 20)
        self._write("test-initiative.md",
                    self.GOOD.replace("$250,000", "300000"))
        self.assertEqual(app_mod.sync_content(), (0, 1, []))
        r = self.db.rfp_by_slug("test-initiative")
        self.assertEqual(r["funding_goal_usd"], 300000.0)   # words/goal updated
        self.assertEqual(r["status"], "archived")           # lifecycle kept
        self.assertEqual(r["safe_address"], "0x" + "aa" * 20)

    def test_sync_reports_bad_file_and_continues(self):
        import app as app_mod
        self._write("good-one.md", self.GOOD)
        self._write("broken.md", "not a content file")
        created, updated, errors = app_mod.sync_content()
        self.assertEqual((created, updated), (1, 0))
        self.assertEqual(len(errors), 1)
        self.assertIn("broken.md", errors[0])
        # deleting a file never deletes the RFP
        os.unlink(os.path.join(self._dir, "content", "rfps", "good-one.md"))
        app_mod.sync_content()
        self.assertIsNotNone(self.db.rfp_by_slug("good-one"))


class TestAdminPassword(unittest.TestCase):
    """The admin password is the admin's to change from the browser: .env
    bootstraps a fresh deploy, then the stored hash takes over."""

    def setUp(self):
        import tempfile
        self._db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._db.close()
        self._patch = mock.patch.object(config, "DB_PATH", self._db.name)
        self._patch.start()
        import db
        db.init()
        self.db = db

    def tearDown(self):
        self._patch.stop()
        os.unlink(self._db.name)

    def test_hash_is_salted_and_verifies(self):
        import app as app_mod
        a = app_mod.hash_password("correct horse battery")
        b = app_mod.hash_password("correct horse battery")
        self.assertNotEqual(a, b)                       # random salt each time
        self.assertNotIn("correct horse", a)            # never stores the secret
        self.assertTrue(app_mod.verify_password("correct horse battery", a))
        self.assertFalse(app_mod.verify_password("wrong", a))
        for junk in ("", "nonsense", "scrypt$bad", None):
            self.assertFalse(app_mod.verify_password("x", junk))

    def test_env_bootstraps_then_stored_hash_wins(self):
        import app as app_mod
        with mock.patch.object(config, "ADMIN_PASSWORD", "from-dot-env"):
            # fresh deploy: .env value is the password
            self.assertTrue(app_mod.admin_password_ok("from-dot-env"))
            self.assertFalse(app_mod.admin_password_ok("something-else"))
            # admin changes it in the browser
            self.db.meta_set("admin_password_hash",
                             app_mod.hash_password("chosen-in-browser"))
            self.assertTrue(app_mod.admin_password_ok("chosen-in-browser"))
            self.assertFalse(app_mod.admin_password_ok("from-dot-env"))
            # documented recovery: drop the hash, .env works again
            self.db.meta_set("admin_password_hash", "")
            self.assertTrue(app_mod.admin_password_ok("from-dot-env"))

    def test_change_password_endpoint_rules(self):
        import app as app_mod
        c = app_mod.app.test_client()
        with c.session_transaction() as s:
            s["admin"] = True
            s["_csrf"] = "tok"
        def post(**form):
            form["_csrf"] = "tok"
            return c.post("/admin/password", data=form,
                          base_url="http://localhost", follow_redirects=False)
        with mock.patch.object(config, "ADMIN_PASSWORD", "from-dot-env"), \
             mock.patch.object(config, "SITE_USERNAME", ""), \
             mock.patch.object(config, "SITE_PASSWORD", ""):
            # wrong current password changes nothing
            r = post(current="nope", new="a" * 12, confirm="a" * 12)
            self.assertIn("wrong", r.headers["Location"].lower())
            self.assertTrue(app_mod.admin_password_ok("from-dot-env"))
            # mismatch changes nothing
            post(current="from-dot-env", new="a" * 12, confirm="b" * 12)
            self.assertTrue(app_mod.admin_password_ok("from-dot-env"))
            # too short changes nothing
            post(current="from-dot-env", new="short", confirm="short")
            self.assertTrue(app_mod.admin_password_ok("from-dot-env"))
            # valid change takes effect
            post(current="from-dot-env", new="a-long-new-password",
                 confirm="a-long-new-password")
            self.assertTrue(app_mod.admin_password_ok("a-long-new-password"))
            self.assertFalse(app_mod.admin_password_ok("from-dot-env"))

    def test_change_password_requires_admin_session(self):
        import app as app_mod
        c = app_mod.app.test_client()  # no admin session
        with mock.patch.object(config, "SITE_USERNAME", ""), \
             mock.patch.object(config, "SITE_PASSWORD", ""):
            r = c.post("/admin/password",
                       data={"current": "x", "new": "y" * 12,
                             "confirm": "y" * 12},
                       base_url="http://localhost")
            self.assertEqual(r.status_code, 302)
            self.assertIn("/admin", r.headers["Location"])  # bounced to login


class TestSiteLock(unittest.TestCase):
    """Private-preview gate: .env bootstraps it, the admin's own credentials
    (stored hashed) take over, and it can be switched off to launch."""

    def setUp(self):
        import tempfile
        import app as app_mod
        self._db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._db.close()
        self._p = mock.patch.object(config, "DB_PATH", self._db.name)
        self._p.start()
        import db
        db.init()
        self.db = db
        app_mod._site_auth_forget()

    def tearDown(self):
        self._p.stop()
        os.unlink(self._db.name)

    def _client(self):
        import app as app_mod
        return app_mod.app.test_client()

    def _auth(self, user, pw):
        import base64
        return {"Authorization": "Basic " + base64.b64encode(
            ("%s:%s" % (user, pw)).encode()).decode()}

    def test_open_site_when_unconfigured(self):
        with mock.patch.object(config, "SITE_USERNAME", ""), \
             mock.patch.object(config, "SITE_PASSWORD", ""):
            self.assertEqual(self._client().get("/static/style.css").status_code,
                             200)

    def test_env_bootstrap_locks_the_site(self):
        with mock.patch.object(config, "SITE_USERNAME", "friend"), \
             mock.patch.object(config, "SITE_PASSWORD", "open-sesame"):
            c = self._client()
            self.assertEqual(c.get("/static/style.css").status_code, 401)
            r = c.get("/static/style.css", headers=self._auth("friend", "wrong"))
            self.assertEqual(r.status_code, 401)
            r = c.get("/static/style.css",
                      headers=self._auth("friend", "open-sesame"))
            self.assertEqual(r.status_code, 200)

    def test_stored_credentials_override_env(self):
        import app as app_mod
        self.db.meta_set("site_username", "viewer")
        self.db.meta_set("site_password_hash",
                         app_mod.hash_password("preview-pass"))
        with mock.patch.object(config, "SITE_USERNAME", "friend"), \
             mock.patch.object(config, "SITE_PASSWORD", "open-sesame"):
            c = self._client()
            # the .env pair no longer works
            r = c.get("/static/style.css",
                      headers=self._auth("friend", "open-sesame"))
            self.assertEqual(r.status_code, 401)
            r = c.get("/static/style.css",
                      headers=self._auth("viewer", "preview-pass"))
            self.assertEqual(r.status_code, 200)
            # second hit uses the cache and must still succeed
            r = c.get("/static/style.css",
                      headers=self._auth("viewer", "preview-pass"))
            self.assertEqual(r.status_code, 200)

    def test_gate_off_makes_site_public_even_with_env_set(self):
        self.db.meta_set("site_gate_off", "1")
        with mock.patch.object(config, "SITE_USERNAME", "friend"), \
             mock.patch.object(config, "SITE_PASSWORD", "open-sesame"):
            self.assertEqual(self._client().get("/static/style.css").status_code,
                             200)

    def test_changing_credentials_signs_out_old_password(self):
        import app as app_mod
        self.db.meta_set("site_username", "viewer")
        self.db.meta_set("site_password_hash", app_mod.hash_password("old-pass"))
        c = self._client()
        self.assertEqual(c.get("/static/style.css",
                               headers=self._auth("viewer", "old-pass")
                               ).status_code, 200)  # now cached
        self.db.meta_set("site_password_hash", app_mod.hash_password("new-pass"))
        app_mod._site_auth_forget()   # what the admin route does on change
        self.assertEqual(c.get("/static/style.css",
                               headers=self._auth("viewer", "old-pass")
                               ).status_code, 401)
        self.assertEqual(c.get("/static/style.css",
                               headers=self._auth("viewer", "new-pass")
                               ).status_code, 200)

    def test_healthz_stays_open_for_uptime_monitors(self):
        with mock.patch.object(config, "SITE_USERNAME", "friend"), \
             mock.patch.object(config, "SITE_PASSWORD", "open-sesame"), \
             mock.patch("app.chain_state",
                        return_value={"tokens": {}, "detail": "t",
                                      "checked_at": 0}):
            self.assertEqual(self._client().get("/healthz").status_code, 200)


class TestScannerLock(unittest.TestCase):
    """The donation scanner must run in exactly one process, even under
    gunicorn's several workers."""

    def test_flock_grants_a_single_owner(self):
        import tempfile
        import app as app_mod
        held = app_mod._scanner_lock_fd[:]
        app_mod._scanner_lock_fd[:] = []
        with mock.patch.object(config, "BASE_DIR", tempfile.mkdtemp()):
            try:
                self.assertTrue(app_mod._acquire_scanner_lock())   # first wins
                self.assertFalse(app_mod._acquire_scanner_lock())  # rest blocked
            finally:
                for f in app_mod._scanner_lock_fd:
                    f.close()
                app_mod._scanner_lock_fd[:] = held

    def test_start_scanner_once_is_idempotent(self):
        import app as app_mod
        app_mod._scanner_started[0] = False
        with mock.patch.object(app_mod, "_acquire_scanner_lock",
                               return_value=True), \
             mock.patch.object(app_mod.threading, "Thread") as thread:
            app_mod.start_scanner_once()
            app_mod.start_scanner_once()
            self.assertEqual(thread.call_count, 1)  # only one scanner thread
        app_mod._scanner_started[0] = False


class TestCompositeDonationKey(unittest.TestCase):
    """One tx that pays two different RFP Safes must credit both RFPs, keyed on
    (tx_hash, rfp_id) — the bug the composite key fixes. Uses a throwaway DB."""

    def setUp(self):
        import tempfile
        import importlib
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        self._patch = mock.patch.object(config, "DB_PATH", self._tmp.name)
        self._patch.start()
        import db
        importlib.reload(db)  # rebuild connection helpers against the temp path
        self.db = db
        db.init()

    def tearDown(self):
        self._patch.stop()
        os.unlink(self._tmp.name)

    def _confirmed(self, usd, donor=DONOR):
        return {"ok": True, "found": True, "pending": False,
                "token_symbol": "USDC",
                "token_address": config.TOKENS["USDC"][0],
                "amount_raw": str(int(usd * 1e6)), "amount": float(usd),
                "amount_usd": float(usd), "donor": donor,
                "detail": "confirmed"}

    def test_one_tx_credits_two_rfps(self):
        rfp_a, _ = self.db.create_rfp("Alpha", "s", "", 0, [], "", "approved")
        rfp_b, _ = self.db.create_rfp("Beta", "s", "", 0, [], "", "approved")
        tx = "0x" + "ab" * 32

        _, s1 = self.db.record_donation(rfp_a, tx, self._confirmed(50))
        _, s2 = self.db.record_donation(rfp_b, tx, self._confirmed(80))
        self.assertEqual(s1, "confirmed")
        self.assertEqual(s2, "confirmed")

        # both RFPs credited independently, with their own amounts
        self.assertEqual(self.db.funding_summary(rfp_a)["donated"], 50)
        self.assertEqual(self.db.funding_summary(rfp_b)["donated"], 80)
        self.assertEqual(len(self.db.donations_for(rfp_a)), 1)
        self.assertEqual(len(self.db.donations_for(rfp_b)), 1)

    def test_same_tx_same_rfp_is_idempotent(self):
        rfp_a, _ = self.db.create_rfp("Alpha", "s", "", 0, [], "", "approved")
        tx = "0x" + "cd" * 32
        self.db.record_donation(rfp_a, tx, self._confirmed(50))
        _, s2 = self.db.record_donation(rfp_a, tx, self._confirmed(50))
        self.assertEqual(s2, "already-confirmed")
        self.assertEqual(len(self.db.donations_for(rfp_a)), 1)
        self.assertEqual(self.db.funding_summary(rfp_a)["donated"], 50)

    def _pending(self):
        # a transfer the scanner saw but couldn't price yet (feed briefly down)
        return {"ok": False, "found": True, "pending": True,
                "token_symbol": "EURC",
                "token_address": config.TOKENS["EURC"][0],
                "amount_raw": "0", "amount": 0.0, "amount_usd": 0.0,
                "donor": DONOR, "detail": "price feed unavailable"}

    def test_pending_donation_is_reverified_and_confirmed(self):
        import app as app_mod
        rfp, _ = self.db.create_rfp("Gamma", "s", "", 0, [], "", "approved")
        self.db.update_rfp(rfp, safe_address="0x" + "11" * 20)
        tx = "0x" + "ef" * 32
        _, st = self.db.record_donation(rfp, tx, self._pending())
        self.assertEqual(st, "pending")                        # stored, not lost
        self.assertEqual(self.db.funding_summary(rfp)["donated"], 0)
        # feed recovers -> the reverify pass confirms it (no re-scan needed)
        with mock.patch.object(app_mod.chain, "verify_donation_tx",
                               return_value=self._confirmed(50)):
            app_mod._reverify_pending(config.TOKENS)
        self.assertEqual(self.db.funding_summary(rfp)["donated"], 50)
        self.assertEqual(len(self.db.donations_for(rfp)), 1)

    def test_safe_address_belongs_to_one_rfp(self):
        a, _ = self.db.create_rfp("A", "s", "", 0, [], "", "approved")
        self.db.create_rfp("B", "s", "", 0, [], "", "approved")
        safe = "0x" + "22" * 20
        self.db.update_rfp(a, safe_address=safe)
        found = self.db.rfp_by_safe_address(safe.upper())  # case-insensitive
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], a)
        self.assertIsNone(self.db.rfp_by_safe_address("0x" + "33" * 20))
