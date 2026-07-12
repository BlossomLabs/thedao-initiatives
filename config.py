"""Central configuration: tokens, treasury, environment.

Token addresses were verified 2026-07 against two independent sources
(CoinGecko contract lookup + Etherscan token pages). chain.verify_tokens()
re-verifies decimals() and symbol() on-chain at startup and disables any
token that does not match, so a config typo cannot mis-encode a donation.
"""
import os
import secrets

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "rfps.db")
ENV_PATH = os.path.join(BASE_DIR, ".env")

# All donations flow to this address (TheDAO Security Fund treasury).
# It must be written in exact EIP-55 checksum form: chain.resolve_treasury()
# re-derives the checksum at startup and the app refuses to accept donations
# on any mismatch, so a typo here cannot silently redirect funds.
# Overridable via TREASURY_ADDRESS in .env.
TREASURY_ADDRESS = "0xD5Cf05f24727C83976652E3586c0e26DD39884e9"
TREASURY_LABEL = "TheDAO Security Fund treasury"

CHAIN_ID = 1  # Ethereum mainnet only

# symbol -> (contract address, decimals)
TOKENS = {
    "USDC":   ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    "USDT":   ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    "DAI":    ("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
    "USDS":   ("0xdC035D45d973E3EC169d2276DDab16f1e407384F", 18),
    "crvUSD": ("0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E", 18),
    "BOLD":   ("0x6440f144b7e50D6a8439336510312d2F54beB01D", 18),
    "fxUSD":  ("0x085780639CC2cACd35E474e71f4d000e2405d8f6", 18),
    # non-USD stables (verified on-chain + CoinGecko 2026-07); their USD value
    # comes from the Chainlink feeds below, never assumed 1:1
    "EURC":   ("0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", 6),
    "ZCHF":   ("0xB58E61C3098d85632Df34EecfB899A1Ed80921cB", 18),
}

# Native ETH donations (plain value transfer to the RFP Safe). Verified via
# the transaction itself; the passive scanner cannot see native transfers,
# so exchange ETH sends need the tx-hash verify (wallet sends auto-verify).
NATIVE_ETH = True
MIN_ETH_DONATION = 0.0005

# Chainlink price feeds (mainnet, all 8 decimals; sanity-checked live 2026-07:
# ETH 1769, EUR 1.143, CHF 1.2413 - each matches independent market data).
CHAINLINK_FEEDS = {
    "ETH":  "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",   # ETH/USD
    "EURC": "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",   # EUR/USD
    "ZCHF": "0x449d117117838fFA61263B61dA6301AA2a88B13A",   # CHF/USD
}

RPC_ENDPOINTS = [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://cloudflare-eth.com",
    "https://eth.drpc.org",
]

# ENS Universal Resolver (ENSv2, 2026). The legacy flat registry was
# deprecated in the ENSv2 migration; the Universal Resolver is the
# ENS-sanctioned entry point for all resolution.
ENS_UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe"

# Independent second opinion for ENS resolution (fund-safety cross-check).
ENS_CROSSCHECK_URL = "https://api.ensdata.net/{name}"

SUBMISSIONS_PER_HOUR_PER_IP = 5
LOGIN_ATTEMPTS_PER_MINUTE_PER_IP = 5

# A donation is only credited once its tx is this many blocks deep, so a
# short reorg cannot leave an RFP crediting money that fell off the chain.
# Three blocks (~36s) covers the 1-2 block reorgs seen on post-merge mainnet
# with little added wait, since this gates real money.
MIN_CONFIRMATIONS = 3

# ---------------------------------------------------------------- Safe-per-RFP
# Each approved RFP gets its own Gnosis Safe (same operational signers every
# time) deployed from the admin panel via the canonical SafeProxyFactory.
# All three addresses verified 2026-07: Etherscan labels + byte-identical
# code on mainnet and Sepolia (Safe deploys deterministically cross-chain).
SAFE_PROXY_FACTORY   = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"
SAFE_SINGLETON       = "0x41675C099F32341bf84BFc5382aF534df5C7461a"
SAFE_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"

SEPOLIA_RPC_ENDPOINTS = [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.drpc.org",
]
SEPOLIA_CHAIN_ID = 11155111

# The 5 operational signers (3-of-5) that own every RFP Safe. Set in .env as
# OPERATIONAL_SIGNERS=0xaaa...,0xbbb...,... (comma-separated, checksummed).
# Safe deployment stays disabled until exactly SAFE_OWNER_COUNT valid,
# distinct addresses are configured, and every deployed Safe is verified
# on-chain against this exact set before the app will show its address.
SAFE_THRESHOLD = 3
SAFE_OWNER_COUNT = 5


def _load_env():
    """Tiny .env loader (no python-dotenv dependency)."""
    data = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    data[k.strip()] = v.strip()
    return data


def _ensure_env():
    """Create .env with generated secrets on first run."""
    env = _load_env()
    changed = False
    if "SECRET_KEY" not in env:
        env["SECRET_KEY"] = secrets.token_hex(32)
        changed = True
    if "ADMIN_PASSWORD" not in env:
        # 5 words from a 64-word list + 4 digits ~= 54 bits of entropy,
        # so online guessing is infeasible even without rate limiting.
        env["ADMIN_PASSWORD"] = "-".join(
            secrets.choice(_WORDS) for _ in range(5
        )) + "-" + str(secrets.randbelow(9000) + 1000)
        changed = True
    if changed:
        with open(ENV_PATH, "w") as f:
            f.write("# Generated by thedao-rfps. Keep private.\n")
            for k, v in env.items():
                f.write("%s=%s\n" % (k, v))
        os.chmod(ENV_PATH, 0o600)
    return env


_WORDS = (
    "ether summit signal beacon vault ledger anchor cipher merkle nonce "
    "oracle raft galaxy ember quartz falcon harbor lumen praxis zephyr "
    "cobalt tundra pyre lagoon basalt comet drift fjord glacier hollow "
    "ivory jasper kelp lantern meadow nectar onyx pebble quill ripple "
    "saffron thicket umber verdant willow xenon yonder zenith amber brook "
    "cedar dune echo flint grove haven iris jade karma lotus mango north"
).split()

ENV = _ensure_env()
SECRET_KEY = ENV["SECRET_KEY"]
ADMIN_PASSWORD = ENV["ADMIN_PASSWORD"]
RPC_URL_OVERRIDE = ENV.get("RPC_URL", "").strip()
PORT = int(ENV.get("PORT", "4482"))
TREASURY_ADDRESS = ENV.get("TREASURY_ADDRESS", "").strip() or TREASURY_ADDRESS
# Only trust X-Forwarded-For when running behind a proxy that sets it.
# Left off by default so client IPs (used for rate limiting) cannot be spoofed.
TRUST_PROXY = ENV.get("TRUST_PROXY", "").strip() in ("1", "true", "yes")
# Send the admin session cookie only over HTTPS. Off by default so local
# http://127.0.0.1 dev works; set COOKIE_SECURE=1 in any real deployment.
COOKIE_SECURE = ENV.get("COOKIE_SECURE", "").strip() in ("1", "true", "yes")
# Global backstop: max failed admin logins per minute across all IPs, to blunt
# distributed (botnet) brute force that per-IP limits cannot see.
LOGIN_ATTEMPTS_PER_MINUTE_GLOBAL = 60

OPERATIONAL_SIGNERS = [
    a.strip() for a in ENV.get("OPERATIONAL_SIGNERS", "").split(",")
    if a.strip()]

# Card payments: fiat-to-crypto checkout that delivers USDC straight to the
# RFP's Safe, where the scanner credits it like any other donation.
# guardarian works with no partner key (donor pastes the address; we show it
# with a copy button). transak/moonpay need a partner API key + a public
# domain; once ONRAMP_API_KEY is set they open fully prefilled.
ONRAMP_PROVIDER = ENV.get("ONRAMP_PROVIDER", "guardarian").strip().lower()
ONRAMP_API_KEY = ENV.get("ONRAMP_API_KEY", "").strip()

# AI board search: a visitor describes what they want to fund and an LLM ranks
# the open RFPs by relevance (top ~10% get moved up, client-side only — the
# stored board order never changes). Any OpenAI-compatible chat-completions
# API works; default is DeepSeek (very cheap: well under $0.001 per search at
# this board size). The feature is hidden until AI_SEARCH_API_KEY is set.
AI_SEARCH_API_KEY = ENV.get("AI_SEARCH_API_KEY", "").strip()
AI_SEARCH_BASE_URL = ENV.get("AI_SEARCH_BASE_URL",
                             "https://api.deepseek.com").strip().rstrip("/")
AI_SEARCH_MODEL = ENV.get("AI_SEARCH_MODEL", "deepseek-chat").strip()

if RPC_URL_OVERRIDE:
    RPC_ENDPOINTS = [RPC_URL_OVERRIDE] + RPC_ENDPOINTS
