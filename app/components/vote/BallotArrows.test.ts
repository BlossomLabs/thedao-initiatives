import { describe, expect, it } from "vitest";
import { arrowPath } from "./BallotArrows";

const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe("arrowPath", () => {
  it("runs from the ballot's chip to the result's, as a curve", () => {
    const { d } = arrowPath({ x: 10, y: 50 }, { x: 300, y: 120 }, "alpha");
    expect(d.startsWith("M 10 50 C ")).toBe(true);
    expect(d.endsWith(", 300 120")).toBe(true);
  });

  it("ends in an open head pointing at the target, from behind it", () => {
    const { head } = arrowPath({ x: 10, y: 50 }, { x: 300, y: 120 }, "alpha");
    const [x1, , tx, ty, x2] = nums(head);
    expect([tx, ty]).toEqual([300, 120]);
    expect(x1).toBeLessThan(300);
    expect(x2).toBeLessThan(300);
  });

  it("each initiative wobbles its own way, the same every time", () => {
    const a = arrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, "alpha");
    expect(arrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, "alpha")).toEqual(a);
    expect(arrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, "beta").d).not.toBe(a.d);
  });
});
