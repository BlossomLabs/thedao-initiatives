"""Ethereum mainnet access: JSON-RPC with failover, ENS resolution,
token sanity checks, and ERC-20 transfer verification.

Design principles:
- The chain is the source of truth. Donation amounts are read from the
  verified Transfer log, never from client input.
- The treasury address (griff.eth) is resolved on-chain AND cross-checked
  against an independent resolver API. If they disagree, donations are
  disabled rather than risking funds going to a wrong address.
- No private keys anywhere. The server only reads the chain.
"""
import json
import time
import urllib.request

from Crypto.Hash import keccak as _keccak

import config

# keccak256("Transfer(address,address,uint256)") — asserted in tests/test_core.py
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

_last_good_rpc = [0]  # index into config.RPC_ENDPOINTS


def keccak256(data: bytes) -> bytes:
    h = _keccak.new(digest_bits=256)
    h.update(data)
    return h.digest()


# ---------------------------------------------------------------- JSON-RPC

class RpcError(Exception):
    pass


def rpc_call(method, params, timeout=10):
    """Call mainnet JSON-RPC with endpoint failover."""
    payload = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
    }).encode()
    endpoints = config.RPC_ENDPOINTS
    order = list(range(len(endpoints)))
    start = _last_good_rpc[0] if _last_good_rpc[0] < len(endpoints) else 0
    order = order[start:] + order[:start]
    last_err = None
    for i in order:
        url = endpoints[i]
        try:
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json",
                         "User-Agent": "thedao-rfps/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                out = json.loads(resp.read().decode())
            if "error" in out and out["error"]:
                raise RpcError(str(out["error"]))
            _last_good_rpc[0] = i
            return out.get("result")
        except Exception as e:  # try next endpoint
            last_err = e
    raise RpcError("all RPC endpoints failed: %s" % last_err)


def eth_call(to, data):
    return rpc_call("eth_call", [{"to": to, "data": data}, "latest"])


# ---------------------------------------------------------------- helpers

def to_checksum(addr: str) -> str:
    """EIP-55 checksum encoding."""
    a = addr.lower().replace("0x", "")
    if len(a) != 40 or any(c not in "0123456789abcdef" for c in a):
        raise ValueError("invalid address: %r" % addr)
    h = keccak256(a.encode()).hex()
    out = "".join(
        c.upper() if c.isalpha() and int(h[i], 16) >= 8 else c
        for i, c in enumerate(a))
    return "0x" + out


def is_address(s: str) -> bool:
    try:
        to_checksum(s)
        return True
    except (ValueError, AttributeError):
        return False


def namehash(name: str) -> bytes:
    """ENS namehash (EIP-137)."""
    node = b"\x00" * 32
    if name:
        for label in reversed(name.lower().split(".")):
            node = keccak256(node + keccak256(label.encode()))
    return node


def _decode_hex_int(h):
    if h in (None, "0x", ""):
        return 0
    return int(h, 16)


def _decode_string_result(hexdata):
    """Decode a solidity `string` return value (also tolerates bytes32)."""
    if not hexdata or hexdata == "0x":
        return ""
    raw = bytes.fromhex(hexdata[2:])
    if len(raw) == 32:  # non-standard bytes32 symbol
        return raw.rstrip(b"\x00").decode("utf-8", "replace")
    if len(raw) >= 64:
        offset = int.from_bytes(raw[0:32], "big")
        if offset + 32 <= len(raw):
            strlen = int.from_bytes(raw[offset:offset + 32], "big")
            return raw[offset + 32:offset + 32 + strlen].decode("utf-8", "replace")
    return ""


# ---------------------------------------------------------------- ENS

def dns_encode(name: str) -> bytes:
    """DNS-encode an ENS name (labels length-prefixed, zero-terminated)."""
    out = b""
    for label in name.lower().split("."):
        raw = label.encode()
        if not 0 < len(raw) < 64:
            raise ValueError("bad label in %r" % name)
        out += bytes([len(raw)]) + raw
    return out + b"\x00"


def _abi_encode_bytes(b: bytes) -> bytes:
    pad = (32 - len(b) % 32) % 32
    return len(b).to_bytes(32, "big") + b + b"\x00" * pad


def resolve_ens_onchain(name: str):
    """Resolve an ENS name via the ENSv2 Universal Resolver.

    Calls UniversalResolver.resolve(dnsEncodedName, addr(node) calldata),
    which handles the full ENSv2 resolution path on-chain.
    """
    node = namehash(name)
    inner = bytes.fromhex("3b3b57de") + node  # addr(bytes32)
    dnsname = dns_encode(name)
    head1 = (0x40).to_bytes(32, "big")
    tail1 = _abi_encode_bytes(dnsname)
    head2 = (0x40 + len(tail1)).to_bytes(32, "big")
    calldata = "0x9061b923" + (head1 + head2 + tail1
                               + _abi_encode_bytes(inner)).hex()
    res = eth_call(config.ENS_UNIVERSAL_RESOLVER, calldata)
    if not res or res == "0x":
        raise RpcError("universal resolver returned nothing for %s" % name)
    raw = bytes.fromhex(res[2:])
    if len(raw) < 96:
        raise RpcError("universal resolver returned short data for %s" % name)
    off = int.from_bytes(raw[0:32], "big")
    ln = int.from_bytes(raw[off:off + 32], "big")
    payload = raw[off + 32:off + 32 + ln]
    if len(payload) < 20 or int.from_bytes(payload[-20:], "big") == 0:
        raise RpcError("%s resolves to zero address" % name)
    return to_checksum("0x" + payload[-20:].hex())


def resolve_ens_crosscheck(name: str):
    """Independent second opinion via ensdata.net."""
    url = config.ENS_CROSSCHECK_URL.format(name=name)
    req = urllib.request.Request(url, headers={"User-Agent": "thedao-rfps/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    addr = data.get("address") or ""
    return to_checksum(addr) if is_address(addr) else None


def resolve_treasury():
    """Resolve the treasury ENS with dual verification.

    Returns (address, verified: bool, detail: str). If verified is False the
    caller must disable donations.
    """
    name = config.TREASURY_ENS
    onchain = resolve_ens_onchain(name)
    try:
        second = resolve_ens_crosscheck(name)
    except Exception as e:
        return onchain, False, "cross-check unavailable: %s" % e
    if second is None:
        return onchain, False, "cross-check returned no address"
    if second.lower() != onchain.lower():
        return onchain, False, (
            "MISMATCH: on-chain=%s cross-check=%s" % (onchain, second))
    return onchain, True, "on-chain and cross-check agree"


# ---------------------------------------------------------------- tokens

def verify_tokens():
    """Verify every configured token against the chain itself.

    Calls decimals() and symbol() on each contract. Returns
    {symbol: {"address", "decimals", "ok", "detail"}}; tokens that fail are
    marked ok=False and must not be offered to donors.
    """
    out = {}
    for sym, (addr, decimals) in config.TOKENS.items():
        entry = {"address": to_checksum(addr), "decimals": decimals,
                 "ok": False, "detail": ""}
        try:
            dec_raw = eth_call(addr, "0x313ce567")  # decimals()
            chain_dec = _decode_hex_int(dec_raw)
            sym_raw = eth_call(addr, "0x95d89b41")  # symbol()
            chain_sym = _decode_string_result(sym_raw)
            if chain_dec != decimals:
                entry["detail"] = ("decimals mismatch: config=%d chain=%d"
                                   % (decimals, chain_dec))
            elif chain_sym.lower() != sym.lower():
                entry["detail"] = ("symbol mismatch: config=%s chain=%s"
                                   % (sym, chain_sym))
            else:
                entry["ok"] = True
                entry["detail"] = "verified on-chain"
        except Exception as e:
            entry["detail"] = "verification failed: %s" % e
        out[sym] = entry
    return out


# ---------------------------------------------------------------- receipts

def verify_donation_tx(tx_hash, treasury, allowed_tokens):
    """Verify an on-chain donation by its transaction hash.

    Checks the receipt for a successful ERC-20 Transfer of an allowed token
    where the recipient is the treasury. Amount and sender are read from the
    log (chain truth), never from the client.

    Returns dict: {found, pending, ok, token_symbol, token_address,
                   amount_raw, amount, donor, detail}
    """
    result = {"found": False, "pending": False, "ok": False,
              "token_symbol": "", "token_address": "", "amount_raw": "0",
              "amount": 0.0, "donor": "", "detail": ""}
    if not (isinstance(tx_hash, str) and tx_hash.startswith("0x")
            and len(tx_hash) == 66):
        result["detail"] = "malformed transaction hash"
        return result
    try:
        int(tx_hash, 16)
    except ValueError:
        result["detail"] = "malformed transaction hash"
        return result

    receipt = rpc_call("eth_getTransactionReceipt", [tx_hash])
    if receipt is None:
        tx = rpc_call("eth_getTransactionByHash", [tx_hash])
        if tx is not None:
            result["found"] = True
            result["pending"] = True
            result["detail"] = "transaction pending, not yet mined"
        else:
            result["detail"] = "transaction not found on mainnet"
        return result

    result["found"] = True
    if receipt.get("status") != "0x1":
        result["detail"] = "transaction reverted"
        return result

    by_addr = {a.lower(): (sym, dec)
               for sym, (a, dec) in allowed_tokens.items()}
    want_to = "0x" + "0" * 24 + treasury.lower().replace("0x", "")

    for log in receipt.get("logs", []):
        addr = (log.get("address") or "").lower()
        topics = log.get("topics") or []
        if addr not in by_addr or len(topics) < 3:
            continue
        if topics[0].lower() != TRANSFER_TOPIC:
            continue
        if topics[2].lower() != want_to:
            continue
        sym, dec = by_addr[addr]
        raw = _decode_hex_int(log.get("data"))
        if raw <= 0:
            continue
        result["ok"] = True
        result["token_symbol"] = sym
        result["token_address"] = to_checksum(addr)
        result["amount_raw"] = str(raw)
        result["amount"] = raw / (10 ** dec)
        result["donor"] = to_checksum("0x" + topics[1][-40:])
        result["detail"] = "verified: %s %s to treasury" % (result["amount"], sym)
        return result

    result["detail"] = ("no transfer of an accepted stablecoin to the "
                        "treasury found in this transaction")
    return result


def get_block_number():
    return _decode_hex_int(rpc_call("eth_blockNumber", []))
