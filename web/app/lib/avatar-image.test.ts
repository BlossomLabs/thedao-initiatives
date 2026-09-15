import { describe, expect, it } from "vitest";
import { encodeUnderLimit, outputSide, squareCrop } from "./avatar-image";

describe("squareCrop", () => {
  it("keeps a square as-is", () => {
    expect(squareCrop(300, 300)).toEqual({ sx: 0, sy: 0, side: 300 });
  });
  it("crops a landscape image to its centre", () => {
    expect(squareCrop(1000, 400)).toEqual({ sx: 300, sy: 0, side: 400 });
  });
  it("crops a portrait image to its centre", () => {
    expect(squareCrop(400, 1000)).toEqual({ sx: 0, sy: 300, side: 400 });
  });
  it("floors odd offsets so the crop stays on whole pixels", () => {
    expect(squareCrop(7, 4)).toEqual({ sx: 1, sy: 0, side: 4 });
  });
});

describe("outputSide", () => {
  it("shrinks large sources to the cap", () => {
    expect(outputSide(4000, 512)).toBe(512);
  });
  it("never upscales small sources", () => {
    expect(outputSide(120, 512)).toBe(120);
  });
});

describe("encodeUnderLimit", () => {
  const blob = (n: number, type: string) => new Blob([new Uint8Array(n)], { type });

  it("returns the first webp that fits", async () => {
    const calls: [string, number][] = [];
    const out = await encodeUnderLimit((type, q) => {
      calls.push([type, q]);
      return Promise.resolve(blob(100, type));
    }, 1000);
    expect(out.type).toBe("image/webp");
    expect(calls).toEqual([["image/webp", 0.9]]);
  });

  it("lowers quality until the result is under the limit", async () => {
    const sizes = [3000, 2000, 500];
    let i = 0;
    const out = await encodeUnderLimit((type) => Promise.resolve(blob(sizes[i++], type)), 1000);
    expect(out.size).toBe(500);
  });

  it("falls back to jpeg when the browser cannot encode webp", async () => {
    const calls: string[] = [];
    const out = await encodeUnderLimit((type) => {
      calls.push(type);
      // Browsers without webp support silently return a PNG instead.
      return Promise.resolve(blob(100, type === "image/webp" ? "image/png" : type));
    }, 1000);
    expect(out.type).toBe("image/jpeg");
    expect(calls).toEqual(["image/webp", "image/jpeg"]);
  });

  it("throws when nothing fits even at the lowest quality", async () => {
    await expect(encodeUnderLimit((type) => Promise.resolve(blob(5000, type)), 1000))
      .rejects.toThrow(/too large/i);
  });

  it("throws when the canvas produces nothing", async () => {
    await expect(encodeUnderLimit(() => Promise.resolve(null), 1000))
      .rejects.toThrow(/couldn't/i);
  });
});
