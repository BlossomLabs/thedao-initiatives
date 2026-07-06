"""Ethereum mainnet access: JSON-RPC with failover, ENS resolution,
token sanity checks, and ERC-20 transfer verification.

Design principles:
- The chain is the source of truth. Donation amounts are read from the
  verified Transfer log, never from client input.
- The treasury is a static, admin-configured address that must round-trip
  EIP-55 checksumming exactly; on any mismatch donations are disabled rather
  than risking funds going to a wrong address. (ENS resolution helpers below
  are kept for future use, e.g. if the treasury moves back to an ENS name.)
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


def rpc_call(method, params, timeout=10, endpoints=None):
    """Call JSON-RPC with endpoint failover (mainnet unless endpoints given)."""
    payload = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
    }).encode()
    sticky = endpoints is None  # remember the good endpoint for mainnet only
    if endpoints is None:
        endpoints = config.RPC_ENDPOINTS
    order = list(range(len(endpoints)))
    if sticky:
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
            if sticky:
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
    """Validate the statically configured treasury address.

    Returns (address, verified: bool, detail: str). If verified is False the
    caller must disable donations.

    The configured value must round-trip EIP-55 checksumming EXACTLY: a
    single mistyped character makes the checksum fail, so a typo disables
    donations instead of redirecting funds.
    """
    configured = config.TREASURY_ADDRESS
    try:
        checksummed = to_checksum(configured)
    except ValueError as e:
        return None, False, "treasury address invalid: %s" % e
    if checksummed != configured:
        return checksummed, False, (
            "treasury address failed EIP-55 checksum (configured=%s, "
            "expected=%s): donations disabled" % (configured, checksummed))
    return checksummed, True, "static treasury address, checksum verified"


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


# ---------------------------------------------------------------- pricing

_rate_cache = {}  # symbol -> (rate, fetched_at)
RATE_TTL = 600


def usd_rate(symbol):
    """USD value of one token. 1.0 for USD stables; Chainlink for the rest."""
    if symbol not in config.CHAINLINK_FEEDS:
        return 1.0
    hit = _rate_cache.get(symbol)
    if hit and time.time() - hit[1] < RATE_TTL:
        return hit[0]
    feed = config.CHAINLINK_FEEDS[symbol]
    raw = _decode_hex_int(eth_call(feed, "0x50d25bcd"))  # latestAnswer()
    if raw <= 0:
        raise RpcError("price feed returned nothing for %s" % symbol)
    rate = raw / 1e8  # all configured feeds use 8 decimals
    if not (0.1 < rate < 1_000_000):
        raise RpcError("price feed for %s out of sane range: %s" % (symbol, rate))
    _rate_cache[symbol] = (rate, time.time())
    return rate


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
              "amount": 0.0, "amount_usd": 0.0, "donor": "", "detail": ""}
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

    # Confirmation-depth check: a freshly-mined tx can still be reorged out.
    # Below MIN_CONFIRMATIONS we report it as pending so it is not credited
    # yet and the client keeps polling.
    mined_block = _decode_hex_int(receipt.get("blockNumber"))
    try:
        head = get_block_number()
        depth = head - mined_block + 1 if mined_block else 0
    except Exception:
        depth = 0
    if mined_block and depth < config.MIN_CONFIRMATIONS:
        result["pending"] = True
        result["detail"] = ("mined, waiting for confirmations (%d/%d)"
                            % (max(depth, 0), config.MIN_CONFIRMATIONS))
        return result

    by_addr = {a.lower(): (sym, dec)
               for sym, (a, dec) in allowed_tokens.items()}
    want_to = "0x" + "0" * 24 + treasury.lower().replace("0x", "")

    # Sum every matching transfer of a single token to the treasury, so a
    # batched/multicall donation is credited in full rather than only its
    # first log. If a tx moves more than one accepted token to the treasury,
    # credit the first token seen and note the rest.
    credited_sym = credited_dec = credited_addr = None
    total_raw = 0
    donor = ""
    extra_tokens = False
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
        if credited_sym is None:
            credited_sym, credited_dec, credited_addr = sym, dec, addr
            donor = to_checksum("0x" + topics[1][-40:])
        if addr == credited_addr:
            total_raw += raw
        else:
            extra_tokens = True

    if credited_sym is not None and total_raw > 0:
        min_raw = 10 ** credited_dec  # dust floor: ignore sub-1-token transfers
        if total_raw < min_raw:
            result["detail"] = ("transfer below the minimum donation of 1 %s"
                                % credited_sym)
            return result
        try:
            rate = usd_rate(credited_sym)
        except Exception as e:
            result["pending"] = True
            result["detail"] = "price feed unavailable, will retry: %s" % e
            return result
        result["ok"] = True
        result["token_symbol"] = credited_sym
        result["token_address"] = to_checksum(credited_addr)
        result["amount_raw"] = str(total_raw)
        result["amount"] = total_raw / (10 ** credited_dec)
        result["amount_usd"] = round(result["amount"] * rate, 2)
        result["donor"] = donor
        result["detail"] = "verified: %s %s to treasury%s" % (
            result["amount"], credited_sym,
            " (other tokens in this tx were not credited)" if extra_tokens else "")
        return result

    # No accepted-token transfer: check for a plain (native) ETH send.
    if config.NATIVE_ETH:
        tx = rpc_call("eth_getTransactionByHash", [tx_hash])
        if tx and (tx.get("to") or "").lower() == treasury.lower():
            value = _decode_hex_int(tx.get("value"))
            eth = value / 1e18
            if 0 < eth < config.MIN_ETH_DONATION:
                result["detail"] = ("ETH amount below the minimum donation "
                                    "of %s ETH" % config.MIN_ETH_DONATION)
                return result
            if eth > 0:
                try:
                    rate = usd_rate("ETH")
                except Exception as e:
                    result["pending"] = True
                    result["detail"] = "price feed unavailable, will retry: %s" % e
                    return result
                result["ok"] = True
                result["token_symbol"] = "ETH"
                result["token_address"] = ""
                result["amount_raw"] = str(value)
                result["amount"] = eth
                result["amount_usd"] = round(eth * rate, 2)
                result["donor"] = to_checksum(tx.get("from"))
                result["detail"] = "verified: %s ETH to treasury" % eth
                return result

    result["detail"] = ("no transfer of an accepted stablecoin or ETH to the "
                        "treasury found in this transaction")
    return result


def get_block_number():
    return _decode_hex_int(rpc_call("eth_blockNumber", []))


# ---------------------------------------------------------------- Safe-per-RFP
# Deploying and verifying per-RFP Gnosis Safes via the canonical
# SafeProxyFactory. Selectors and event topics are computed from their
# signatures at import time (never memorized constants), and asserted
# against known values in tests/test_core.py.

def _selector(sig: str) -> str:
    return "0x" + keccak256(sig.encode()).hex()[:8]


def _event_topic(sig: str) -> str:
    return "0x" + keccak256(sig.encode()).hex()


SEL_CREATE_PROXY = _selector("createProxyWithNonce(address,bytes,uint256)")
SEL_SETUP = _selector(
    "setup(address[],uint256,address,bytes,address,address,uint256,address)")
SEL_GET_OWNERS = _selector("getOwners()")
SEL_GET_THRESHOLD = _selector("getThreshold()")
TOPIC_PROXY_CREATION = _event_topic("ProxyCreation(address,address)")


def _abi_word(v) -> bytes:
    """One 32-byte ABI word from an int or a 0x-address string."""
    if isinstance(v, str):
        return bytes(12) + bytes.fromhex(v.lower().replace("0x", ""))
    return int(v).to_bytes(32, "big")


def encode_safe_setup(owners, threshold, fallback_handler) -> bytes:
    """ABI-encode Safe.setup(owners, threshold, 0, 0x, handler, 0, 0, 0).

    Layout: 8 head words, then the owners array tail, then the empty
    `data` bytes tail. Offsets are byte offsets from the start of the args.
    """
    head_size = 8 * 32
    owners_tail = _abi_word(len(owners)) + b"".join(_abi_word(o) for o in owners)
    owners_off = head_size
    data_off = owners_off + len(owners_tail)
    zero = "0x" + "0" * 40
    head = b"".join([
        _abi_word(owners_off),        # offset -> owners[]
        _abi_word(threshold),
        _abi_word(zero),              # to (no delegate call)
        _abi_word(data_off),          # offset -> data (empty bytes)
        _abi_word(fallback_handler),
        _abi_word(zero),              # paymentToken
        _abi_word(0),                 # payment
        _abi_word(zero),              # paymentReceiver
    ])
    data_tail = _abi_word(0)          # bytes length 0
    return bytes.fromhex(SEL_SETUP[2:]) + head + owners_tail + data_tail


def encode_create_proxy(singleton, initializer: bytes, salt_nonce: int) -> str:
    """Calldata for SafeProxyFactory.createProxyWithNonce."""
    head_size = 3 * 32
    pad = (32 - len(initializer) % 32) % 32
    init_tail = (_abi_word(len(initializer)) + initializer + b"\x00" * pad)
    head = b"".join([
        _abi_word(singleton),
        _abi_word(head_size),         # offset -> initializer bytes
        _abi_word(salt_nonce),
    ])
    return SEL_CREATE_PROXY + (head + init_tail).hex()


def safe_deploy_calldata(rfp_id: int) -> str:
    """The exact factory calldata the admin wallet sends to deploy an RFP Safe."""
    init = encode_safe_setup(config.OPERATIONAL_SIGNERS, config.SAFE_THRESHOLD,
                             config.SAFE_FALLBACK_HANDLER)
    return encode_create_proxy(config.SAFE_SINGLETON, init, int(rfp_id))


def signers_configured():
    """Exactly SAFE_OWNER_COUNT distinct, checksummed signer addresses."""
    s = config.OPERATIONAL_SIGNERS
    if len(s) != config.SAFE_OWNER_COUNT:
        return False, ("%d of %d signers configured"
                       % (len(s), config.SAFE_OWNER_COUNT))
    seen = set()
    for a in s:
        if not is_address(a):
            return False, "invalid signer address: %r" % a
        if to_checksum(a) != a:
            return False, "signer not in checksum form: %s" % a
        if a.lower() in seen:
            return False, "duplicate signer: %s" % a
        seen.add(a.lower())
    return True, "ok"


def _chain_endpoints(chain_name):
    if chain_name == "sepolia":
        return config.SEPOLIA_RPC_ENDPOINTS
    return None  # mainnet default


def extract_deployed_safe(tx_hash, chain_name="mainnet"):
    """Parse a deploy tx receipt for the factory's ProxyCreation event.

    Returns (safe_address, None) or (None, reason). Only trusts events
    emitted BY the canonical factory address.
    """
    eps = _chain_endpoints(chain_name)
    receipt = rpc_call("eth_getTransactionReceipt", [tx_hash], endpoints=eps)
    if receipt is None:
        return None, "pending"
    if receipt.get("status") != "0x1":
        return None, "deploy transaction reverted"
    for log in receipt.get("logs", []):
        if (log.get("address") or "").lower() != config.SAFE_PROXY_FACTORY.lower():
            continue
        topics = log.get("topics") or []
        if not topics or topics[0].lower() != TOPIC_PROXY_CREATION:
            continue
        # proxy address: indexed -> topics[1] (v1.4.1). Older layouts put it
        # in data; handle both.
        if len(topics) >= 2:
            return to_checksum("0x" + topics[1][-40:]), None
        data = log.get("data") or ""
        if len(data) >= 66:
            return to_checksum("0x" + data[2:66][-40:]), None
    return None, "no ProxyCreation event from the canonical factory in this tx"


def verify_safe(address, chain_name="mainnet"):
    """Verify a deployed Safe matches our exact spec before trusting it.

    Checks: owners == configured signers (exact set), threshold, and that
    the proxy points at the canonical v1.4.1 singleton.
    Returns (ok, detail).
    """
    eps = _chain_endpoints(chain_name)

    def call(data):
        return rpc_call("eth_call", [{"to": address, "data": data}, "latest"],
                        endpoints=eps)

    ok, why = signers_configured()
    if not ok:
        return False, why
    try:
        thr = _decode_hex_int(call(SEL_GET_THRESHOLD))
        if thr != config.SAFE_THRESHOLD:
            return False, "threshold is %d, expected %d" % (
                thr, config.SAFE_THRESHOLD)
        raw = call(SEL_GET_OWNERS)
        blob = bytes.fromhex(raw[2:])
        n = int.from_bytes(blob[32:64], "big")
        owners = {("0x" + blob[64 + 32 * i + 12:64 + 32 * (i + 1)].hex()).lower()
                  for i in range(n)}
        expected = {a.lower() for a in config.OPERATIONAL_SIGNERS}
        if owners != expected:
            return False, ("owner set mismatch: on-chain has %d owners, "
                           "not the configured signers" % n)
        slot0 = rpc_call("eth_getStorageAt", [address, "0x0", "latest"],
                         endpoints=eps)
        impl = ("0x" + slot0[-40:]).lower()
        if impl != config.SAFE_SINGLETON.lower():
            return False, "proxy singleton is not canonical Safe v1.4.1"
        return True, ("verified: %d-of-%d Safe with the configured "
                      "operational signers" % (config.SAFE_THRESHOLD, n))
    except Exception as e:
        return False, "verification failed: %s" % e
