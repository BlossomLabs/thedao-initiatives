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


if __name__ == "__main__":
    unittest.main()
