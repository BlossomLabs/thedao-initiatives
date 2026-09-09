import {
  SAFE_FALLBACK_HANDLER,
  SAFE_OWNER_COUNT,
  SAFE_PROXY_FACTORY,
  SAFE_SINGLETON,
  SAFE_THRESHOLD,
} from "../config.ts";
import { isAddress, toChecksum } from "./address.ts";
import {
  decodeHexInt,
  encodeCreateProxy,
  encodeSafeSetup,
  SEL_GET_OWNERS,
  SEL_GET_THRESHOLD,
} from "./abi.ts";
import { eventTopic, keccakHex, utf8 } from "./keccak.ts";
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

/** Deterministic per-initiative salt: keccak256(slug) as uint256. */
export const safeSaltNonce = (slug: string): bigint => BigInt(keccakHex(utf8(slug)));

/** The exact factory calldata the admin wallet sends to deploy an RFP Safe. */
export function safeDeployCalldata(signers: string[], slug: string): string {
  const init = encodeSafeSetup(signers, SAFE_THRESHOLD, SAFE_FALLBACK_HANDLER);
  return encodeCreateProxy(SAFE_SINGLETON, init, safeSaltNonce(slug));
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
