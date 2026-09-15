/** Shared test utilities: fake RPC, wallet signing, canned chain data. */
import {
  concatHex,
  decodeFunctionData,
  getContractAddress,
  type Hex,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Rpc } from "../chain/rpc.ts";
import { TRANSFER_TOPIC } from "../chain/verify.ts";
import { SAFE_PROXY_CREATION_CODE, SAFE_PROXY_FACTORY } from "../config.ts";

const FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address)",
]);

/**
 * What an eth_call of createProxyWithNonce would return: the CREATE2 address,
 * computed here with viem (independently of chain/safe.ts) from the calldata
 * the app built. salt = keccak(keccak(initializer) ++ saltNonce),
 * initCode = proxyCreationCode ++ singleton.
 */
export function simulateCreateProxy(calldata: string): string {
  const { args } = decodeFunctionData({ abi: FACTORY_ABI, data: calldata as Hex });
  const [singleton, initializer, saltNonce] = args as [Hex, Hex, bigint];
  const salt = keccak256(concatHex([keccak256(initializer), pad(toHex(saltNonce), { size: 32 })]));
  return getContractAddress({
    opcode: "CREATE2",
    from: SAFE_PROXY_FACTORY as Hex,
    salt,
    bytecode: concatHex([SAFE_PROXY_CREATION_CODE as Hex, pad(singleton, { size: 32 })]),
  });
}

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
  const clean = privHex.replace(/^0x/, "").padStart(64, "0");
  const account = privateKeyToAccount(("0x" + clean) as Hex);
  return {
    address: account.address as string,
    sign: (message: string): Promise<string> => account.signMessage({ message }),
  };
}
