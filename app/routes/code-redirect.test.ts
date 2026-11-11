import { expect, it } from "vitest";
import { clientLoader } from "./code-redirect";

it("a printed /devcon/<code> QR code opens /vote/<code>", () => {
  const res = clientLoader({ params: { code: "17.abc" } } as never) as Response;
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/vote/17.abc");
});
