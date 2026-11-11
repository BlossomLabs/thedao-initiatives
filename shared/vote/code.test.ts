import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { codeMessage, formatCode, parseCode, verifyCode } from "./code.ts";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const issuer = privateKeyToAccount(KEY);
const sign = (n: number) => issuer.signMessage({ message: codeMessage(n) });

describe("paper codes", () => {
  test("the signed message names the event and the number", () => {
    expect(codeMessage(17)).toBe("TheDAO Devcon 8 badge #17");
  });

  test("a code signed by the issuer verifies to its number", async () => {
    expect(await verifyCode(formatCode(17, await sign(17)), issuer.address)).toBe(17);
  });

  test("codes past the first 200 are valid with no change", async () => {
    expect(await verifyCode(formatCode(201, await sign(201)), issuer.address)).toBe(201);
    expect(await verifyCode(formatCode(100000, await sign(100000)), issuer.address)).toBe(100000);
  });

  test("a signature for another number does not verify", async () => {
    expect(await verifyCode(formatCode(18, await sign(17)), issuer.address)).toBeNull();
  });

  test("another issuer's code does not verify", async () => {
    const other = privateKeyToAccount(
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    );
    const sig = await other.signMessage({ message: codeMessage(17) });
    expect(await verifyCode(formatCode(17, sig), issuer.address)).toBeNull();
  });

  test("the issuer address compares without case", async () => {
    expect(await verifyCode(formatCode(3, await sign(3)), issuer.address.toLowerCase())).toBe(3);
  });

  test("mangled codes parse to null and never throw", async () => {
    const good = formatCode(17, await sign(17));
    const bad = [
      "",
      "17",
      "17.",
      ".abc",
      "0." + good.split(".")[1],
      "-1." + good.split(".")[1],
      "x." + good.split(".")[1],
      "017." + good.split(".")[1],
      "17.%%%",
      `17.${"A".repeat(10)}`,
      good.slice(0, -3),
      good + "AAAA",
      "17." + good.split(".")[1] + ".x",
    ];
    for (const b of bad) {
      expect(parseCode(b), b).toBeNull();
      expect(await verifyCode(b, issuer.address), b).toBeNull();
    }
  });

  test("parse returns the number and a 65-byte hex signature", async () => {
    const sig = await sign(5);
    expect(parseCode(formatCode(5, sig))).toEqual({ n: 5, signature: sig });
  });

  test("codes are URL-safe", async () => {
    expect(formatCode(5, await sign(5))).toMatch(/^[0-9]+\.[A-Za-z0-9_-]+$/);
  });
});
