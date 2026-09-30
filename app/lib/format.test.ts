import { describe, expect, it } from "vitest";
import { dt, pct, shortAddr, usd, usdShort } from "./format";
import { parseUsd, toBaseUnits, tokenQty, transferCalldata } from "./donate";
import { avatarSrc, pfpDefaultIndex, presetUri } from "./avatar";

describe("format", () => {
  it("usd matches the jinja filter", () => {
    expect(usd(0)).toBe("$0");
    expect(usd(49.5)).toBe("$49.50");
    expect(usd(1000)).toBe("$1,000");
    expect(usd(236438.4)).toBe("$236,438");
    expect(usd(-5)).toBe("$0");
    expect(usd("junk")).toBe("$0");
  });
  it("shortAddr / dt / pct", () => {
    expect(shortAddr("0x839395e20bbB182fa440d08F850E6c7A8f6F0780")).toBe("0x8393…0780");
    expect(shortAddr("")).toBe("");
    expect(dt(1788953372)).toMatch(/Sep 0[89], 2026/);
    expect(pct(150938, 236438)).toBe(63.8);
    expect(pct(500, 100)).toBe(100);
    expect(pct(1, 0)).toBe(0);
  });
});

describe("donate math", () => {
  it("toBaseUnits", () => {
    expect(toBaseUnits("250", 6)).toBe(250_000_000n);
    expect(toBaseUnits("0.5", 18)).toBe(500_000_000_000_000_000n);
    expect(toBaseUnits("1.1234567", 6)).toBeNull();
    expect(toBaseUnits("0", 6)).toBeNull();
    expect(toBaseUnits("abc", 6)).toBeNull();
  });
  it("tokenQty / parseUsd", () => {
    expect(tokenQty(100, 1, 6)).toBe("100");
    expect(tokenQty(100, 2500, 18)).toBe("0.04");
    expect(tokenQty(50, 1.143, 6)).toBe("43.744532");
    expect(parseUsd("49.50")).toBe(49.5);
    expect(Number.isNaN(parseUsd("$5"))).toBe(true);
  });
  it("transferCalldata matches the API test vector", () => {
    const to = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";
    const expected = "0xa9059cbb" + "000000000000000000000000" + to.slice(2).toLowerCase() +
      (250_000_000).toString(16).padStart(64, "0");
    expect(transferCalldata(to, 250_000_000n)).toBe(expected);
    expect(transferCalldata(to, 250_000_000n)).toHaveLength(2 + 8 + 64 + 64);
  });
});

describe("avatars", () => {
  it("default index is deterministic and presets render", () => {
    const a = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";
    expect(pfpDefaultIndex(a)).toBe(pfpDefaultIndex(a.toLowerCase()));
    expect(pfpDefaultIndex(a)).toBeLessThan(10);
    expect(avatarSrc(a, "preset:3")).toBe(presetUri(3));
    expect(avatarSrc(a, "ipfs:x", "https://gw/ipfs/x")).toBe("https://gw/ipfs/x");
    expect(decodeURIComponent(presetUri(0))).toContain("<svg");
  });
});

describe("usdShort (list rows on phones)", () => {
  it("under a thousand: whole dollars", () => {
    expect(usdShort(0)).toBe("$0");
    expect(usdShort(9.97)).toBe("$10");
    expect(usdShort(274.04)).toBe("$274");
  });
  it("thousands as k: one decimal under 10k, none above", () => {
    expect(usdShort(1_108)).toBe("$1.1k");
    expect(usdShort(2_000)).toBe("$2k");
    expect(usdShort(37_500)).toBe("$38k");
    expect(usdShort(100_050)).toBe("$100k");
    expect(usdShort(999_400)).toBe("$999k");
  });
  it("millions as M, one decimal", () => {
    expect(usdShort(999_600)).toBe("$1M");
    expect(usdShort(1_250_000)).toBe("$1.3M");
    expect(usdShort(-5)).toBe("$0");
  });
});
