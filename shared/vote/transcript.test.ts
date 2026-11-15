import { expect, test } from "vitest";
import { encodeAbiParameters, keccak256, zeroAddress, zeroHash } from "viem";
import { type TranscriptEvent, transcriptOf } from "./transcript.ts";

// Values printed by `forge test --match-test test_transcriptVector -vv`
// (vote/test/SignedBallots.t.sol): the contract's own running hash.
const ALICE = "0x7F1d642DbfD62aD4A8fA9810eA619707d09825D0";
const BOB = "0x5793e629c061e7FD642ab6A1b4d552CeC0e2D606";
const AFTER_TWO_VOTES = "0xec5f702e68d55bd39878d3ffc456f6c0b1cb94a16311bb391823968b4dd0224c";
const AFTER_REVOCATION = "0x06ca72bf1b7a0e51976c4ba219d1af5eef9642a6499cd6794206944f8eeaa2f8";
const AFTER_LATER_BALLOT = "0xc8bd77f8ca523ce8a4347bf5157c7cb5981f72cbe58c85f2b2e7abbe8d453e43";

const two: TranscriptEvent[] = [
  { tokenId: "1", voter: ALICE, nonce: 1n, ballot: "0x010101ff" },
  { tokenId: "2", voter: ALICE, nonce: 1n, ballot: "0x01010101" },
];

test("transcript: matches the contract's running hash", () => {
  const r = transcriptOf(two);
  expect(r.transcript).toEqual(AFTER_TWO_VOTES);
  expect(r.count).toEqual(2);
  expect(r.lastHash.get("1")).toEqual(keccak256("0x010101ff"));
  expect(transcriptOf([]).transcript).toEqual(`0x${"00".repeat(32)}`);
});

test("transcript: revocation then a new ballot keeps the transcript", () => {
  const revoked = transcriptOf([...two, { tokenId: "1", revoked: true }]);
  expect(revoked.transcript).toEqual(AFTER_REVOCATION);
  expect(revoked.count).toEqual(3);
  expect(revoked.lastHash.get("1")).toEqual(`0x${"00".repeat(32)}`);
  const later = transcriptOf([
    ...two,
    { tokenId: "1", revoked: true },
    { tokenId: "1", voter: BOB, nonce: 2n, ballot: "0x010101ff" },
  ]);
  expect(later.transcript).toEqual(AFTER_LATER_BALLOT);
  expect(later.count).toEqual(4);
  expect(later.lastHash.get("1")).toEqual(keccak256("0x010101ff"));
});

test("transcript: a changed ballot byte changes the hash", () => {
  const changed = transcriptOf([{ ...two[0], ballot: "0x010101fe" } as TranscriptEvent, two[1]]);
  expect(changed.transcript).not.toEqual(AFTER_TWO_VOTES);
});

test("transcript: a round from before Nov 14 matches the legacy formula", () => {
  // Contracts before 16ee6b4 hashed (prev, tokenId, voter, nonce, ballotHash, bytes32(0)).
  const types = [
    { type: "bytes32" },
    { type: "uint256" },
    { type: "address" },
    { type: "uint64" },
    { type: "bytes32" },
    { type: "bytes32" },
  ] as const;
  const h1 = keccak256(encodeAbiParameters(types, [
    zeroHash,
    1n,
    ALICE,
    1n,
    keccak256("0x010101ff"),
    zeroHash,
  ]));
  const h2 = keccak256(encodeAbiParameters(types, [h1, 1n, zeroAddress, 1n, zeroHash, zeroHash]));
  const events: TranscriptEvent[] = [
    { tokenId: "1", voter: ALICE, nonce: 1n, ballot: "0x010101ff" },
    { tokenId: "1", revoked: true },
  ];
  expect(transcriptOf(events, true).transcript).toEqual(h2);
  expect(transcriptOf(events, true).count).toEqual(2);
  expect(transcriptOf(events).transcript).not.toEqual(h2);
});
