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

it("a bug's own message never reaches the page", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const bug = new TypeError("Cannot read properties of undefined (reading 'length')");
  expect(errorMessage(bug)).toBe("Something went wrong.");
  expect(errorMessage(bug, "Search failed.")).toBe("Search failed.");
  expect(log).toHaveBeenCalledWith(bug);
  log.mockRestore();
  expect(errorMessage(new TypeError("Failed to fetch"))).toBe(
    "Could not reach the server. Check your connection and try again.",
  );
  expect(errorMessage(new Error("slow down"))).toBe("Slow down.");
});
