import { ApiError, errorMessage, sentence } from "./api";

test("server fragments read as a sentence on screen", () => {
  expect(sentence("slow down")).toBe("Slow down.");
  expect(sentence("Nothing changed.")).toBe("Nothing changed.");
  expect(errorMessage(new ApiError(429, "too many searches, wait a minute"))).toBe(
    "Too many searches, wait a minute.",
  );
});

test("an unexplained server failure is not shown as 'internal error'", () => {
  expect(errorMessage(new ApiError(500, "internal error"))).toBe(
    "Something went wrong on our side. Please try again in a moment.",
  );
});

test("a refused wallet request is a plain line, not viem's dump", () => {
  const refused = Object.assign(
    new Error(
      "User rejected the request.\n\nRequest Arguments:\n  chain: Ethereum\n\nVersion: viem@2",
    ),
    { code: 4001, shortMessage: "User rejected the request." },
  );
  expect(errorMessage(refused)).toBe("You rejected the request in the wallet.");
});

test("a value that is not an error gets the caller's fallback", () => {
  expect(errorMessage(undefined, "Vote failed.")).toBe("Vote failed.");
  expect(errorMessage(undefined)).toBe("Something went wrong.");
});
