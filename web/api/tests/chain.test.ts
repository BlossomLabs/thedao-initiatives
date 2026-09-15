import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { keccak256, selector, utf8 } from "../chain/keccak.ts";
import { isAddress, toChecksum } from "../chain/address.ts";
import {
  encodeCreateProxy,
  encodeSafeSetup,
  SEL_CREATE_PROXY,
  SEL_GET_OWNERS,
  SEL_GET_THRESHOLD,
  SEL_SETUP,
} from "../chain/abi.ts";
import { TRANSFER_TOPIC, verifyDonationTx } from "../chain/verify.ts";
import { createPricer, RATE_MAX_STALENESS } from "../chain/price.ts";
import { RpcError } from "../chain/rpc.ts";
import {
  extractDeployedSafe,
  safeDeployCalldata,
  signersConfigured,
  TOPIC_PROXY_CREATION,
  verifySafe,
} from "../chain/safe.ts";
import {
  encodeIsValidSignature,
  isValidContractSignature,
  MAX_CONTRACT_SIGNATURE_BYTES,
  personalMessageHash,
  recoverPersonalSign,
  SEL_IS_VALID_SIGNATURE,
} from "../chain/sign.ts";
import { encodeFunctionData, parseAbi } from "viem";
import { parseSiweMessage, verifySiwe } from "../chain/siwe.ts";
import * as config from "../config.ts";
import { encodeHex } from "@std/encoding";
import {
  chainlinkRound,
  DONOR,
  fakeRpc,
  SAFE,
  SIGNERS,
  transferLog,
  wallet,
  word,
} from "./helpers.ts";

const USDC = config.TOKENS.USDC[0];
const DAI = config.TOKENS.DAI[0];
const TX = "0x" + "ab".repeat(32);
const NOW = 1_800_000_000;
const one = () => Promise.resolve(1.0);

Deno.test("keccak constants match published values", () => {
  assertEquals(
    TRANSFER_TOPIC,
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  );
  assertEquals(selector("transfer(address,uint256)"), "0xa9059cbb");
  assertEquals(selector("decimals()"), "0x313ce567");
  assertEquals(selector("symbol()"), "0x95d89b41");
  assertEquals(SEL_CREATE_PROXY, "0x1688f0b9");
  assertEquals(SEL_SETUP, "0xb63e800d");
  assertEquals(SEL_GET_OWNERS, "0xa0e67e2b");
  assertEquals(SEL_GET_THRESHOLD, "0xe75235b8");
  assertEquals(
    TOPIC_PROXY_CREATION,
    "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235",
  );
});

Deno.test("EIP-55 reference vectors and config addresses", () => {
  for (
    const v of [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ]
  ) assertEquals(toChecksum(v.toLowerCase()), v);
  for (const [sym, [addr]] of Object.entries(config.TOKENS)) {
    assertEquals(toChecksum(addr), addr, `config address for ${sym} is not checksummed`);
  }
  for (
    const a of [
      ...config.CURATOR_ADDRESSES,
      ...config.DEFAULT_ADMIN_ADDRESSES,
      config.BADGE_CONTRACT,
    ]
  ) {
    assertEquals(toChecksum(a), a);
  }
  for (const bad of ["0x123", "", "0x" + "g".repeat(40), "hello", 42, null]) {
    assertFalse(isAddress(bad));
  }
});

function verify(receipt: unknown, tx: unknown = null, head = 200) {
  const rpc = fakeRpc({
    eth_getTransactionReceipt: () => receipt,
    eth_getTransactionByHash: () => tx,
    eth_blockNumber: () => "0x" + head.toString(16),
  });
  return verifyDonationTx(rpc, one, TX, SAFE, config.TOKENS);
}
const receipt = (status: string, logs: unknown[]) => ({
  status,
  blockNumber: "0x64",
  logs,
});

Deno.test("verifyDonationTx: valid USDC transfer", async () => {
  const r = await verify(receipt("0x1", [transferLog(USDC, DONOR, SAFE, 250_000_000n)]));
  assert(r.ok, r.detail);
  assertEquals(r.tokenSymbol, "USDC");
  assertEquals(r.amount, 250);
  assertEquals(r.amountUsd, 250);
  assertEquals(r.donor.toLowerCase(), DONOR);
});

Deno.test("verifyDonationTx: 18-decimal DAI", async () => {
  const r = await verify(
    receipt("0x1", [transferLog(DAI, DONOR, SAFE, 5n * 10n ** 18n)]),
  );
  assert(r.ok);
  assertEquals(r.amount, 5);
});

Deno.test("verifyDonationTx: rejects wrong recipient, unknown token, revert, zero", async () => {
  assertFalse(
    (await verify(receipt("0x1", [transferLog(USDC, DONOR, DONOR, 10n ** 6n)]))).ok,
  );
  assertFalse(
    (await verify(
      receipt("0x1", [transferLog("0x" + "99".repeat(20), DONOR, SAFE, 10n ** 6n)]),
    )).ok,
  );
  const rev = await verify(receipt("0x0", [transferLog(USDC, DONOR, SAFE, 10n ** 6n)]));
  assertFalse(rev.ok);
  assertStringIncludes(rev.detail, "reverted");
  assertFalse((await verify(receipt("0x1", [transferLog(USDC, DONOR, SAFE, 0n)]))).ok);
});

Deno.test("verifyDonationTx: pending / not found / malformed", async () => {
  const p = await verify(null, { hash: TX });
  assert(p.found && p.pending);
  const nf = await verify(null, null);
  assertFalse(nf.found);
  const rpc = fakeRpc({});
  const m = await verifyDonationTx(rpc, one, "0x1234", SAFE, config.TOKENS);
  assertStringIncludes(m.detail, "malformed");
});

Deno.test("verifyDonationTx: sums same-token transfers, notes extra tokens, dust floor", async () => {
  const r = await verify(receipt("0x1", [
    transferLog(USDC, DONOR, SAFE, 1_000_000n),
    transferLog(USDC, DONOR, SAFE, 2_000_000n),
    transferLog(DAI, DONOR, SAFE, 10n ** 18n),
  ]));
  assert(r.ok);
  assertEquals(r.amount, 3);
  assertStringIncludes(r.detail, "other tokens");
  const dust = await verify(receipt("0x1", [transferLog(USDC, DONOR, SAFE, 999_999n)]));
  assertFalse(dust.ok);
  assertStringIncludes(dust.detail, "minimum");
});

Deno.test("verifyDonationTx: confirmation depth", async () => {
  const shallow = await verify(
    receipt("0x1", [transferLog(USDC, DONOR, SAFE, 10n ** 6n)]),
    null,
    101,
  );
  assert(shallow.pending);
  assertStringIncludes(shallow.detail, "confirmations (2/3)");
  const deep = await verify(
    receipt("0x1", [transferLog(USDC, DONOR, SAFE, 10n ** 6n)]),
    null,
    102,
  );
  assert(deep.ok);
});

Deno.test("verifyDonationTx: native ETH", async () => {
  const run = (valueWei: bigint, to = SAFE) => {
    const rpc = fakeRpc({
      eth_getTransactionReceipt: () => ({ status: "0x1", blockNumber: "0x64", logs: [] }),
      eth_getTransactionByHash: () => ({
        to,
        from: DONOR,
        value: "0x" + valueWei.toString(16),
      }),
      eth_blockNumber: () => "0x6e",
      eth_call: () => chainlinkRound(1769e8, NOW),
    });
    return verifyDonationTx(
      rpc,
      createPricer(rpc, () => NOW),
      "0x" + "cd".repeat(32),
      SAFE,
      config.TOKENS,
    );
  };
  const r = await run(10n ** 18n);
  assert(r.ok);
  assertEquals(r.tokenSymbol, "ETH");
  assertEquals(r.amount, 1);
  assertEquals(r.amountUsd, 1769);
  assertEquals(r.donor.toLowerCase(), DONOR);
  assertFalse((await run(10n ** 18n, DONOR)).ok);
  const dust = await run(10n ** 12n);
  assertFalse(dust.ok);
  assertStringIncludes(dust.detail, "minimum");
});

Deno.test("usdRate: stables are 1, feeds via Chainlink, guards", async () => {
  const rate = createPricer(fakeRpc({}), () => NOW);
  for (const s of ["USDC", "USDT", "DAI", "USDS", "crvUSD", "BOLD", "fxUSD"]) {
    assertEquals(await rate(s), 1);
  }
  const eur = createPricer(
    fakeRpc({
      eth_call: (p) => {
        assertEquals((p[0] as { to: string }).to, config.CHAINLINK_FEEDS.EURC);
        return chainlinkRound(114_300_000, NOW);
      },
    }),
    () => NOW,
  );
  assertEquals(await eur("EURC"), 1.143);
  await assertRejects(
    () =>
      createPricer(fakeRpc({ eth_call: () => chainlinkRound(1, NOW) }), () => NOW)(
        "ZCHF",
      ),
    RpcError,
  );
  await assertRejects(
    () =>
      createPricer(
        fakeRpc({
          eth_call: () => chainlinkRound(114_300_000, NOW - RATE_MAX_STALENESS - 3600),
        }),
        () => NOW,
      )("EURC"),
    RpcError,
    "stale",
  );
  await assertRejects(
    () =>
      createPricer(
        fakeRpc({ eth_call: () => chainlinkRound(114_300_000, 0) }),
        () => NOW,
      )("EURC"),
    RpcError,
    "incomplete",
  );
});

Deno.test("Safe setup / createProxy encoding layout", () => {
  const blob = encodeSafeSetup(SIGNERS, 3, config.SAFE_FALLBACK_HANDLER);
  assertEquals(encodeHex(blob.slice(0, 4)), "b63e800d");
  const args = blob.slice(4);
  const w = (i: number) => BigInt("0x" + encodeHex(args.slice(i * 32, i * 32 + 32)));
  assertEquals(w(0), 256n);
  assertEquals(w(1), 3n);
  const off = 256;
  assertEquals(BigInt("0x" + encodeHex(args.slice(off, off + 32))), 5n);
  assertEquals(
    "0x" + encodeHex(args.slice(off + 44, off + 64)),
    SIGNERS[0].toLowerCase(),
  );
  assertEquals(w(3), BigInt(256 + 32 + 5 * 32));
  assertEquals(BigInt("0x" + encodeHex(args.slice(Number(w(3)), Number(w(3)) + 32))), 0n);

  const data = encodeCreateProxy(config.SAFE_SINGLETON, blob, 42n);
  assert(data.startsWith("0x1688f0b9"));
  const raw = data.slice(10);
  assertEquals("0x" + raw.slice(24, 64), config.SAFE_SINGLETON.toLowerCase());
  assertEquals(BigInt("0x" + raw.slice(128, 192)), 42n);
  const initOff = Number(BigInt("0x" + raw.slice(64, 128)));
  const ln = Number(BigInt("0x" + raw.slice(initOff * 2, initOff * 2 + 64)));
  assertEquals(ln, blob.length);
  assertEquals(raw.slice(initOff * 2 + 64, initOff * 2 + 64 + ln * 2), encodeHex(blob));
  assert(safeDeployCalldata(SIGNERS, "some-slug").startsWith("0x1688f0b9"));
});

Deno.test("extractDeployedSafe trusts only the canonical factory", async () => {
  const proxy = "0xAbcDabCDabcdAbCdAbCdABCDabcDABcDABCDabCD";
  const log = (address: string) => ({
    address,
    topics: [TOPIC_PROXY_CREATION, "0x" + "0".repeat(24) + proxy.slice(2).toLowerCase()],
    data: "0x",
  });
  const good = fakeRpc({
    eth_getTransactionReceipt: () => ({
      status: "0x1",
      logs: [log(config.SAFE_PROXY_FACTORY.toLowerCase())],
    }),
  });
  const [addr, err] = await extractDeployedSafe(good, TX);
  assertEquals(err, null);
  assertEquals(addr?.toLowerCase(), proxy.toLowerCase());
  const bad = fakeRpc({
    eth_getTransactionReceipt: () => ({
      status: "0x1",
      logs: [log("0x" + "99".repeat(20))],
    }),
  });
  const [a2, e2] = await extractDeployedSafe(bad, TX);
  assertEquals(a2, null);
  assertStringIncludes(e2!, "no ProxyCreation");
  const [, e3] = await extractDeployedSafe(
    fakeRpc({ eth_getTransactionReceipt: () => null }),
    TX,
  );
  assertEquals(e3, "pending");
});

Deno.test("verifySafe checks owner set, threshold, singleton, handler", async () => {
  const encodedOwners = (addrs: string[]) =>
    "0x" + word(32) + word(addrs.length) +
    addrs.map((a) => "0".repeat(24) + a.slice(2).toLowerCase()).join("");
  const calls: Record<string, string> = {
    [SEL_GET_THRESHOLD]: "0x" + word(3),
    [SEL_GET_OWNERS]: encodedOwners(SIGNERS),
  };
  const fbSlot = "0x" + encodeHex(keccak256(utf8("fallback_manager.handler.address")));
  const rpc = fakeRpc({
    eth_call: (p) => calls[(p[0] as { data: string }).data],
    eth_getStorageAt: (p) =>
      p[1] === fbSlot
        ? "0x" + "0".repeat(24) + config.SAFE_FALLBACK_HANDLER.slice(2).toLowerCase()
        : "0x" + "0".repeat(24) + config.SAFE_SINGLETON.slice(2).toLowerCase(),
  });
  const [ok, detail] = await verifySafe(rpc, "0x" + "aa".repeat(20), SIGNERS);
  assert(ok, detail);
  calls[SEL_GET_OWNERS] = encodedOwners([...SIGNERS.slice(0, 4), "0x" + "99".repeat(20)]);
  const [ok2, d2] = await verifySafe(rpc, "0x" + "aa".repeat(20), SIGNERS);
  assertFalse(ok2);
  assertStringIncludes(d2, "mismatch");
});

Deno.test("signersConfigured validation", () => {
  assert(signersConfigured(SIGNERS)[0]);
  assertFalse(signersConfigured(SIGNERS.slice(0, 4))[0]);
  assertStringIncludes(
    signersConfigured([...SIGNERS.slice(0, 4), SIGNERS[0]])[1],
    "duplicate",
  );
  assertStringIncludes(
    signersConfigured([
      ...SIGNERS.slice(0, 4),
      config.SAFE_FALLBACK_HANDLER.toLowerCase(),
    ])[1],
    "checksum",
  );
});

// Known-good vectors generated with eth-account 0.13 (throwaway keys).
const VECTOR_TS = 1755200000;
const VECTORS = [
  {
    address: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    content: "a".repeat(64),
    signature:
      "0x8922627290054f55199f9f0a77c7d7cdd5780dc2543bca323d023d0f2de1b82e2b350aafa69d992dff7d069050aee1bfd37aa4e03e8f35992e040a25b60eb2eb1b",
  },
  {
    address: "0x1563915e194D8CfBA1943570603F7606A3115508",
    content: "b".repeat(64),
    signature:
      "0x31aeacf2835ddfb19d23d9428be8b0ba30b551c8768c852fd88755ca5d76792a1e549bb7484cee831cb56017e848b7af18a93bbfd8f737eec38537f2880b1cbc1b",
  },
];
const vectorMessage = (v: { content: string }) =>
  `TheDAO Security Fund\naction:post\ninitiative:test-initiative\ncontent:${v.content}\nts:${VECTOR_TS}`;

Deno.test("recoverPersonalSign: known-good vectors, wrong sig, malformed, local wallet", async () => {
  for (const v of VECTORS) {
    assertEquals(await recoverPersonalSign(vectorMessage(v), v.signature), v.address);
  }
  assert(
    await recoverPersonalSign(vectorMessage(VECTORS[0]), VECTORS[1].signature) !==
      VECTORS[0].address,
  );
  for (
    const sig of ["", "0x", "0x1234", "0x" + "zz".repeat(65), "0x" + "00".repeat(65)]
  ) {
    assertEquals(await recoverPersonalSign("hello", sig), null);
  }
  const w = wallet("0x" + "11".repeat(32));
  assertEquals(w.address, VECTORS[0].address);
  assertEquals(
    await recoverPersonalSign("hello world", await w.sign("hello world")),
    w.address,
  );
});

const SPEC_MESSAGE = `example.com wants you to sign in with your Ethereum account:
0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2

I accept the ExampleOrg Terms of Service: https://example.com/tos

URI: https://example.com/login
Version: 1
Chain ID: 1
Nonce: 32891756
Issued At: 2021-09-30T16:25:24Z
Resources:
- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/
- https://example.com/my-web2-claim.json`;

Deno.test("SIWE parser: spec example, no-statement form, rejects junk", () => {
  const m = parseSiweMessage(SPEC_MESSAGE);
  assertEquals(m.domain, "example.com");
  assertEquals(m.address, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  assertStringIncludes(m.statement!, "Terms of Service");
  assertEquals(m.uri, "https://example.com/login");
  assertEquals(m.chainId, 1);
  assertEquals(m.nonce, "32891756");
  assertEquals(m.resources.length, 2);
  const noStmt = parseSiweMessage(
    "https://app.example wants you to sign in with your Ethereum account:\n" +
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\n\n\nURI: https://app.example\nVersion: 1\nChain ID: 1\nNonce: abcdefgh\nIssued At: 2021-09-30T16:25:24Z",
  );
  assertEquals(noStmt.scheme, "https");
  assertEquals(noStmt.statement, undefined);
  for (
    const bad of [
      "",
      "hello",
      SPEC_MESSAGE.replace("Version: 1", "Version: 2"),
      SPEC_MESSAGE.replace("Nonce: 32891756\n", ""),
      SPEC_MESSAGE.replace("Issued At: 2021-09-30T16:25:24Z", "Issued At: yesterday"),
    ]
  ) {
    let threw = false;
    try {
      parseSiweMessage(bad);
    } catch {
      threw = true;
    }
    assert(threw, `should reject: ${bad.slice(0, 20)}`);
  }
});

Deno.test("verifySiwe: happy path and each rejection", async () => {
  const w = wallet("0x" + "22".repeat(32));
  const issued = new Date(NOW * 1000).toISOString();
  const msg = (
    over: Partial<Record<"domain" | "uri" | "chain" | "issued", string>> = {},
  ) =>
    `${
      over.domain ?? "fund.example"
    } wants you to sign in with your Ethereum account:\n${w.address}\n\n\n` +
    `URI: ${over.uri ?? "https://fund.example"}\nVersion: 1\nChain ID: ${
      over.chain ?? "1"
    }\nNonce: abcdefgh12\nIssued At: ${over.issued ?? issued}`;
  const base = {
    domains: ["fund.example"],
    origins: ["https://fund.example"],
    chainId: 1,
    now: NOW,
    skewSecs: 300,
  };
  const ok = await verifySiwe({ ...base, message: msg(), signature: await w.sign(msg()) });
  assertEquals(ok[1], null);
  assertEquals(ok[0]!.address, w.address);
  const cases: [string, string][] = [
    [msg({ domain: "evil.example" }), "domain"],
    [msg({ uri: "https://evil.example/x" }), "uri"],
    [msg({ chain: "10" }), "chain"],
    [msg({ issued: new Date((NOW - 1000) * 1000).toISOString() }), "issuedAt"],
  ];
  for (const [m, why] of cases) {
    const [, err] = await verifySiwe({ ...base, message: m, signature: await w.sign(m) });
    assertStringIncludes(err ?? "", why);
  }
  const other = wallet("0x" + "33".repeat(32));
  const [, err] = await verifySiwe({
    ...base,
    message: msg(),
    signature: await other.sign(msg()),
  });
  assertStringIncludes(err ?? "", "signature");
});

Deno.test("encodeIsValidSignature matches viem's ABI encoding", () => {
  const abi = parseAbi(["function isValidSignature(bytes32,bytes) view returns (bytes4)"]);
  const hash = personalMessageHash("hello");
  for (const len of [0, 65, 130, 33]) {
    const sig = new Uint8Array(len).map((_, i) => i + 1);
    const expected = encodeFunctionData({
      abi,
      functionName: "isValidSignature",
      args: [("0x" + encodeHex(hash)) as `0x${string}`, ("0x" + encodeHex(sig)) as `0x${string}`],
    });
    assertEquals(encodeIsValidSignature(hash, sig), expected);
  }
});

Deno.test("verifySiwe: EIP-1271 fallback for contract accounts", async () => {
  const account = SAFE;
  const issued = new Date(NOW * 1000).toISOString();
  const message =
    `fund.example wants you to sign in with your Ethereum account:\n${account}\n\n\n` +
    `URI: https://fund.example\nVersion: 1\nChain ID: 1\nNonce: abcdefgh12\nIssued At: ${issued}`;
  const base = {
    message,
    domains: ["fund.example"],
    origins: ["https://fund.example"],
    chainId: 1,
    now: NOW,
    skewSecs: 300,
  };
  // A 2-of-n Safe signature: two 65-byte parts, longer than any EOA signature.
  const signature = "0x" + "ab".repeat(130);
  const magic = SEL_IS_VALID_SIGNATURE + "0".repeat(56);
  const calls: unknown[] = [];
  const contract = (answer: unknown) =>
    fakeRpc({
      eth_call: (params) => {
        calls.push(params);
        const [tx] = params as [{ to: string; data: string }];
        assertEquals(tx.to.toLowerCase(), account.toLowerCase());
        assertEquals(
          tx.data,
          encodeIsValidSignature(
            personalMessageHash(message),
            new Uint8Array(130).fill(0xab),
          ),
        );
        return answer;
      },
    });

  // Without an rpc the contract signature is just an invalid signature.
  assertStringIncludes((await verifySiwe({ ...base, signature }))[1] ?? "", "signature");
  // The contract accepts it.
  const ok = await verifySiwe({ ...base, signature, rpc: contract(magic) });
  assertEquals(ok[1], null);
  assertEquals(ok[0]!.address, account);
  assertEquals(calls.length, 1);
  // The contract (or an EOA, answering "0x") rejects it.
  for (const answer of ["0x", "0x" + "00".repeat(32), magic + "00", null]) {
    const [, err] = await verifySiwe({ ...base, signature, rpc: contract(answer) });
    assertStringIncludes(err ?? "", "signature");
  }
  // RPC trouble fails closed.
  const down = fakeRpc({
    eth_call: () => {
      throw new RpcError("all endpoints failed");
    },
  });
  assertStringIncludes((await verifySiwe({ ...base, signature, rpc: down }))[1] ?? "", "signature");
  // Oversized or malformed signatures never reach the chain.
  const never = fakeRpc({});
  assertFalse(
    await isValidContractSignature(
      never,
      account,
      message,
      "0x" + "ab".repeat(MAX_CONTRACT_SIGNATURE_BYTES + 1),
    ),
  );
  assertFalse(await isValidContractSignature(never, account, message, "0xabc"));
  assertFalse(await isValidContractSignature(never, account, message, "not hex"));
});

Deno.test("verifySiwe: a valid EOA signature never touches the rpc", async () => {
  const w = wallet("0x" + "44".repeat(32));
  const issued = new Date(NOW * 1000).toISOString();
  const message =
    `fund.example wants you to sign in with your Ethereum account:\n${w.address}\n\n\n` +
    `URI: https://fund.example\nVersion: 1\nChain ID: 1\nNonce: abcdefgh12\nIssued At: ${issued}`;
  const [m, err] = await verifySiwe({
    message,
    signature: await w.sign(message),
    domains: ["fund.example"],
    origins: ["https://fund.example"],
    chainId: 1,
    now: NOW,
    skewSecs: 300,
    rpc: fakeRpc({}),
  });
  assertEquals(err, null);
  assertEquals(m!.address, w.address);
});

import { predictSafeAddress } from "../chain/safe.ts";

Deno.test("predictSafeAddress matches a Safe deployed from the panel on mainnet", () => {
  // initiatives.thedao.fund, 2026-09-15: the Safe bound to a-unified-platform-for-web3-opsec
  // sits at the CREATE2 address of its slug salt.
  assertEquals(
    predictSafeAddress(SIGNERS, "a-unified-platform-for-web3-opsec"),
    "0x4534fA9FaEdE981FF7b9c9bFe112067ECA216609",
  );
  assert(predictSafeAddress(SIGNERS, "another-slug") !== predictSafeAddress(SIGNERS, "a-slug"));
});
