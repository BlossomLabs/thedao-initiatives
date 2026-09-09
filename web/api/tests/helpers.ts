/** Shared test utilities: fake RPC, wallet signing, canned chain data. */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { encodeHex } from "@std/encoding";
import { keccak256 } from "../chain/keccak.ts";
import { toChecksum } from "../chain/address.ts";
import { personalMessageHash } from "../chain/sign.ts";
import type { Rpc } from "../chain/rpc.ts";
import { TRANSFER_TOPIC } from "../chain/verify.ts";

export const SIGNERS = [
  "0x839395e20bbB182fa440d08F850E6c7A8f6F0780",
  "0xC46c67Bb7E84490D7EbdD0b8ecDaca68Cf3823F4",
  "0x939E50655cf6dA7D643CFf8Cfa31c3033b16328A",
  "0xb760FE1bbC4A2752aBCBb28291a57Cb0cA99fF44",
  "0x5256d6d94eD14667fa1661a99F5B142B1e051B8e",
];
export const SAFE = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";
export const DONOR = "0x1111111111111111111111111111111111111111";

export function word(n: bigint | number): string {
  return BigInt(n).toString(16).padStart(64, "0");
}

/** Chainlink latestRoundData() blob: (roundId, answer, startedAt, updatedAt, answeredInRound). */
export function chainlinkRound(answer: number | bigint, updatedAt: number): string {
  const mask = (1n << 256n) - 1n;
  return "0x" + [1n, BigInt(answer) & mask, BigInt(updatedAt), BigInt(updatedAt), 1n]
    .map((w) => w.toString(16).padStart(64, "0")).join("");
}

export function transferLog(
  token: string,
  sender: string,
  recipient: string,
  raw: bigint,
) {
  const pad = (a: string) => "0x" + "0".repeat(24) + a.toLowerCase().replace(/^0x/, "");
  return {
    address: token,
    topics: [TRANSFER_TOPIC, pad(sender), pad(recipient)],
    data: "0x" + raw.toString(16),
  };
}

export type Handlers = Record<string, (params: unknown[]) => unknown>;

/** A fake Rpc from a method -> handler map; unknown methods throw. */
export function fakeRpc(handlers: Handlers): Rpc {
  return (method, params) => {
    const h = handlers[method];
    if (!h) throw new Error(`unexpected rpc ${method}`);
    return Promise.resolve(h(params));
  };
}

/** Deterministic throwaway wallet from a 32-byte hex private key. */
export function wallet(privHex: string) {
  const priv = new Uint8Array(32);
  const clean = privHex.replace(/^0x/, "").padStart(64, "0");
  for (let i = 0; i < 32; i++) priv[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  const pub = secp256k1.getPublicKey(priv, false);
  const address = toChecksum("0x" + encodeHex(keccak256(pub.slice(1)).slice(-20)));
  return {
    address,
    sign(message: string): string {
      const sig = secp256k1.sign(personalMessageHash(message), priv, {
        prehash: false,
        format: "recovered",
      });
      // noble "recovered" = [v(0/1), r, s]; wallets emit r || s || v(27/28)
      const v = sig[0] + 27;
      return "0x" + encodeHex(sig.slice(1)) + v.toString(16).padStart(2, "0");
    },
  };
}
