import {
  SAFE_FALLBACK_HANDLER,
  SAFE_OWNER_COUNT,
  SAFE_PROXY_CREATION_CODE,
  SAFE_PROXY_FACTORY,
  SAFE_SINGLETON,
  SAFE_THRESHOLD,
} from "../config.ts";
import { isAddress, toChecksum } from "./address.ts";
import {
  abiWord,
  concat,
  decodeHexInt,
  encodeCreateProxy,
  encodeSafeSetup,
  SEL_GET_OWNERS,
  SEL_GET_THRESHOLD,
} from "./abi.ts";
import { eventTopic, hexToBytes, keccak256, keccakHex, utf8 } from "./keccak.ts";
import { type Rpc } from "./rpc.ts";

export const TOPIC_PROXY_CREATION = eventTopic("ProxyCreation(address,address)");

/** Exactly SAFE_OWNER_COUNT distinct, checksummed signer addresses. */
export function signersConfigured(signers: string[]): [boolean, string] {
  if (signers.length !== SAFE_OWNER_COUNT) {
    return [false, `${signers.length} of ${SAFE_OWNER_COUNT} signers configured`];
  }
  const seen = new Set<string>();
  for (const a of signers) {
    if (!isAddress(a)) return [false, `invalid signer address: ${a}`];
    if (toChecksum(a) !== a) return [false, `signer not in checksum form: ${a}`];
    if (seen.has(a.toLowerCase())) return [false, `duplicate signer: ${a}`];
    seen.add(a.toLowerCase());
  }
  return [true, "ok"];
}

/** Deterministic per-initiative salt, independent of reusable public URLs. */
export const safeSaltNonce = (deploymentKey: string): bigint =>
  BigInt(keccakHex(utf8(deploymentKey)));

/** The exact factory calldata the admin wallet sends to deploy an RFP Safe. */
export function safeDeployCalldata(signers: string[], deploymentKey: string): string {
  const init = encodeSafeSetup(signers, SAFE_THRESHOLD, SAFE_FALLBACK_HANDLER);
  return encodeCreateProxy(SAFE_SINGLETON, init, safeSaltNonce(deploymentKey));
}

/**
 * Where createProxyWithNonce(singleton, initializer, saltNonce) puts this
 * initiative's Safe: CREATE2 from the canonical factory, salt =
 * keccak(keccak(initializer) ++ saltNonce). Pure, so it also answers "was it
 * ever deployed?" without a tx hash: check for code at this address.
 */
export function predictSafeAddress(signers: string[], deploymentKey: string): string {
  const init = encodeSafeSetup(signers, SAFE_THRESHOLD, SAFE_FALLBACK_HANDLER);
  const salt = keccak256(concat(keccak256(init), abiWord(safeSaltNonce(deploymentKey))));
  const initCodeHash = keccak256(
    concat(hexToBytes(SAFE_PROXY_CREATION_CODE), abiWord(SAFE_SINGLETON)),
  );
  const h = keccakHex(
    concat(hexToBytes("0xff"), hexToBytes(SAFE_PROXY_FACTORY), salt, initCodeHash),
  );
  return toChecksum("0x" + h.slice(-40));
}

/** Is there code at this address? A deployed Safe never loses it. */
export async function hasCode(rpc: Rpc, address: string): Promise<boolean> {
  const code = String(await rpc("eth_getCode", [address, "latest"]) ?? "0x");
  return code !== "0x" && code !== "";
}

/**
 * The Safe this initiative's deploy lands on, checked against the chain
 * before anyone is told to send money there. Already deployed: it must pass
 * verifySafe. Not yet: the factory's own answer to an eth_call of the deploy
 * calldata must equal the local prediction. Throws when either disagrees.
 */
export async function resolveSafe(
  rpc: Rpc,
  signers: string[],
  deploymentKey: string,
): Promise<{ address: string; deployed: boolean }> {
  const [ok, why] = signersConfigured(signers);
  if (!ok) throw new Error(why);
  const address = predictSafeAddress(signers, deploymentKey);
  if (await hasCode(rpc, address)) {
    const [good, detail] = await verifySafe(rpc, address, signers);
    if (!good) throw new Error(`Safe at ${address} REJECTED: ${detail}`);
    return { address, deployed: true };
  }
  let simulated = "";
  try {
    const raw = await rpc("eth_call", [
      { to: SAFE_PROXY_FACTORY, data: safeDeployCalldata(signers, deploymentKey) },
      "latest",
    ]);
    simulated = toChecksum("0x" + decodeHexInt(raw).toString(16).padStart(40, "0"));
  } catch (e) {
    throw new Error(`could not predict the Safe address: factory call failed: ${String(e)}`);
  }
  if (simulated !== address) {
    throw new Error(
      `could not predict the Safe address: factory says ${simulated}, computed ${address}`,
    );
  }
  return { address, deployed: false };
}

/** Parse a deploy tx receipt for the canonical factory's ProxyCreation event. */
export async function extractDeployedSafe(
  rpc: Rpc,
  txHash: string,
): Promise<[string, null] | [null, string]> {
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]) as
    | { status?: string; logs?: { address?: string; topics?: string[]; data?: string }[] }
    | null;
  if (!receipt) return [null, "pending"];
  if (receipt.status !== "0x1") return [null, "deploy transaction reverted"];
  for (const log of receipt.logs ?? []) {
    if ((log.address ?? "").toLowerCase() !== SAFE_PROXY_FACTORY.toLowerCase()) continue;
    const topics = log.topics ?? [];
    if (!topics.length || topics[0].toLowerCase() !== TOPIC_PROXY_CREATION) continue;
    if (topics.length >= 2) return [toChecksum("0x" + topics[1].slice(-40)), null];
    const data = log.data ?? "";
    if (data.length >= 66) return [toChecksum("0x" + data.slice(2, 66).slice(-40)), null];
  }
  return [null, "no ProxyCreation event from the canonical factory in this tx"];
}

/** Verify a deployed Safe matches our exact spec before trusting it. */
export async function verifySafe(
  rpc: Rpc,
  address: string,
  signers: string[],
): Promise<[boolean, string]> {
  const [ok, why] = signersConfigured(signers);
  if (!ok) return [false, why];
  const call = (data: string) => rpc("eth_call", [{ to: address, data }, "latest"]);
  try {
    const thr = Number(decodeHexInt(await call(SEL_GET_THRESHOLD)));
    if (thr !== SAFE_THRESHOLD) {
      return [false, `threshold is ${thr}, expected ${SAFE_THRESHOLD}`];
    }
    const raw = String(await call(SEL_GET_OWNERS)).slice(2);
    const n = Number(BigInt("0x" + raw.slice(64, 128)));
    const owners = new Set<string>();
    for (let i = 0; i < n; i++) {
      owners.add("0x" + raw.slice(128 + 64 * i + 24, 128 + 64 * (i + 1)).toLowerCase());
    }
    const expected = new Set(signers.map((a) => a.toLowerCase()));
    if (owners.size !== expected.size || [...expected].some((a) => !owners.has(a))) {
      return [
        false,
        `owner set mismatch: on-chain has ${n} owners, not the configured signers`,
      ];
    }
    const slot0 = String(await rpc("eth_getStorageAt", [address, "0x0", "latest"]));
    if (("0x" + slot0.slice(-40)).toLowerCase() !== SAFE_SINGLETON.toLowerCase()) {
      return [false, "proxy singleton is not canonical Safe v1.4.1"];
    }
    const fbSlot = keccakHex(utf8("fallback_manager.handler.address"));
    const fbRaw = String(await rpc("eth_getStorageAt", [address, fbSlot, "latest"]));
    if (("0x" + fbRaw.slice(-40)).toLowerCase() !== SAFE_FALLBACK_HANDLER.toLowerCase()) {
      return [false, "fallback handler is not the canonical Safe handler"];
    }
    return [
      true,
      `verified: ${SAFE_THRESHOLD}-of-${n} Safe with the configured operational signers`,
    ];
  } catch (e) {
    return [false, `verification failed: ${String(e)}`];
  }
}
