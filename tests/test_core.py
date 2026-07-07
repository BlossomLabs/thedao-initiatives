"""Tests for the fund-critical logic. Run: python3 -m unittest discover tests -v

Everything here guards money paths: keccak constants, address checksumming,
ENS namehash, and Transfer-log verification (against a synthetic receipt and
against real mainnet ground truth in test_live).
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chain
import config


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

    def test_universal_resolver_selector(self):
        self.assertEqual(chain.keccak256(b"resolve(bytes,bytes)")[:4].hex(),
                         "9061b923")

    def test_ens_addr_selector(self):
        self.assertEqual(chain.keccak256(b"addr(bytes32)")[:4].hex(),
                         "3b3b57de")

    def test_dns_encode(self):
        self.assertEqual(chain.dns_encode("griff.eth"),
                         b"\x05griff\x03eth\x00")

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


class TestNamehash(unittest.TestCase):
    def test_eip137_vectors(self):
        # Official EIP-137 test vectors.
        self.assertEqual(chain.namehash("").hex(), "0" * 64)
        self.assertEqual(
            chain.namehash("eth").hex(),
            "93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae")
        self.assertEqual(
            chain.namehash("foo.eth").hex(),
            "de9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f")


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


TREASURY = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780"
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
                "0x" + "ab" * 32, TREASURY, config.TOKENS)

    def test_valid_usdc_transfer(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, TREASURY, 250_000_000)]))  # 250 USDC
        self.assertTrue(r["ok"])
        self.assertEqual(r["token_symbol"], "USDC")
        self.assertEqual(r["amount"], 250.0)
        self.assertEqual(r["donor"].lower(), DONOR.lower())

    def test_valid_dai_transfer_18_decimals(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(DAI, DONOR, TREASURY, 42 * 10 ** 18)]))
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
                          DONOR, TREASURY, 10 ** 18)]))
        self.assertFalse(r["ok"])

    def test_rejects_reverted_tx(self):
        r = self._verify(_fake_receipt("0x0", [
            _transfer_log(USDC, DONOR, TREASURY, 250_000_000)]))
        self.assertFalse(r["ok"])
        self.assertIn("reverted", r["detail"])

    def test_rejects_zero_amount(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, TREASURY, 0)]))
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
        r = chain.verify_donation_tx("nonsense", TREASURY, config.TOKENS)
        self.assertFalse(r["ok"])
        self.assertIn("malformed", r["detail"])

    def test_picks_treasury_transfer_among_many_logs(self):
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, DONOR, 999),
            _transfer_log(DAI, DONOR, TREASURY, 7 * 10 ** 18),
            _transfer_log(USDC, DONOR, DONOR, 999),
        ]))
        self.assertTrue(r["ok"])
        self.assertEqual(r["token_symbol"], "DAI")
        self.assertEqual(r["amount"], 7.0)

    def test_sums_multiple_transfers_of_same_token(self):
        # a batched/multicall donation moving the token to treasury twice
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, TREASURY, 100_000_000),
            _transfer_log(USDC, DONOR, TREASURY, 150_000_000),
        ]))
        self.assertTrue(r["ok"])
        self.assertEqual(r["amount"], 250.0)

    def test_rejects_dust_below_one_token(self):
        # 0.5 USDC is below the 1-token dust floor
        r = self._verify(_fake_receipt("0x1", [
            _transfer_log(USDC, DONOR, TREASURY, 500_000)]))
        self.assertFalse(r["ok"])
        self.assertIn("minimum", r["detail"])

    def test_confirmation_depth_pending_when_too_shallow(self):
        # receipt is mined at block 100; head is also 100 -> depth 1 < 2
        receipt = {"status": "0x1", "blockNumber": hex(100),
                   "logs": [_transfer_log(USDC, DONOR, TREASURY, 250_000_000)]}

        def fake_rpc(method, params, timeout=10):
            if method == "eth_getTransactionReceipt":
                return receipt
            if method == "eth_blockNumber":
                return hex(100)
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            r = chain.verify_donation_tx("0x" + "ab" * 32, TREASURY,
                                         config.TOKENS)
        self.assertFalse(r["ok"])
        self.assertTrue(r["pending"])

    def test_confirmation_depth_ok_when_deep_enough(self):
        receipt = {"status": "0x1", "blockNumber": hex(100),
                   "logs": [_transfer_log(USDC, DONOR, TREASURY, 250_000_000)]}

        def fake_rpc(method, params, timeout=10):
            if method == "eth_getTransactionReceipt":
                return receipt
            if method == "eth_blockNumber":
                return hex(105)  # 6 confirmations
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            r = chain.verify_donation_tx("0x" + "ab" * 32, TREASURY,
                                         config.TOKENS)
        self.assertTrue(r["ok"])
        self.assertEqual(r["amount"], 250.0)


class TestTreasuryGuard(unittest.TestCase):
    def test_valid_checksum_verifies(self):
        with mock.patch.object(config, "TREASURY_ADDRESS",
                               "0xD5Cf05f24727C83976652E3586c0e26DD39884e9"):
            addr, verified, _ = chain.resolve_treasury()
            self.assertTrue(verified)
            self.assertEqual(addr, "0xD5Cf05f24727C83976652E3586c0e26DD39884e9")

    def test_bad_checksum_disables_donations(self):
        # same address, one character case flipped -> checksum fails
        with mock.patch.object(config, "TREASURY_ADDRESS",
                               "0xd5Cf05f24727C83976652E3586c0e26DD39884e9"):
            _, verified, detail = chain.resolve_treasury()
            self.assertFalse(verified)
            self.assertIn("checksum", detail)


class TestLiveChain(unittest.TestCase):
    """Live mainnet checks. Skipped when RFPS_SKIP_LIVE=1."""

    @unittest.skipIf(os.environ.get("RFPS_SKIP_LIVE") == "1", "live disabled")
    def test_token_verification_against_mainnet(self):
        results = chain.verify_tokens()
        for sym, entry in results.items():
            self.assertTrue(entry["ok"],
                            "%s failed on-chain check: %s" % (sym, entry["detail"]))

    @unittest.skipIf(os.environ.get("RFPS_SKIP_LIVE") == "1", "live disabled")
    def test_treasury_resolution_dual_source(self):
        addr, verified, detail = chain.resolve_treasury()
        self.assertTrue(chain.is_address(addr))
        self.assertTrue(verified, "treasury cross-check failed: %s" % detail)


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

        def fake_rpc(method, params, timeout=10, endpoints=None):
            if method == "eth_call":
                return calls[params[0]["data"]]
            if method == "eth_getStorageAt":
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
            return hex(114_300_000)  # 1.143 with 8 decimals
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            self.assertAlmostEqual(chain.usd_rate("EURC"), 1.143)

    def test_insane_feed_value_raises(self):
        def fake_rpc(method, params, timeout=10, endpoints=None):
            return hex(1)  # 0.00000001 USD: out of sane range
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            with self.assertRaises(chain.RpcError):
                chain.usd_rate("ZCHF")


class TestNativeEthDonation(unittest.TestCase):
    def setUp(self):
        chain._rate_cache.clear()

    def _verify(self, tx_value_wei, tx_to=TREASURY):
        receipt = {"status": "0x1", "blockNumber": hex(100), "logs": []}
        tx = {"to": tx_to, "from": DONOR, "value": hex(tx_value_wei)}

        def fake_rpc(method, params, timeout=10, endpoints=None):
            if method == "eth_getTransactionReceipt":
                return receipt
            if method == "eth_getTransactionByHash":
                return tx
            if method == "eth_blockNumber":
                return hex(110)
            if method == "eth_call":  # ETH/USD feed
                return hex(int(1769 * 1e8))
            raise AssertionError("unexpected rpc %s" % method)
        with mock.patch.object(chain, "rpc_call", fake_rpc):
            return chain.verify_donation_tx("0x" + "cd" * 32, TREASURY,
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
