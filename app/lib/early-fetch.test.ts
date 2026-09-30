import { afterEach, expect, it, vi } from "vitest";
import { EARLY_FETCH_SCRIPT, takeEarly } from "./early-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.__early;
});

/** Run the head script the way the browser does: before any module, on the current URL. */
function runScript(pathname: string) {
  globalThis.history.replaceState(null, "", pathname);
  new Function(EARLY_FETCH_SCRIPT)();
}

it("starts the board request on the board page only, as the app would send it", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  runScript("/submit");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(takeEarly("/api/board")).toBeUndefined();
  runScript("/");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/board");
  expect(init.credentials).toBe("include");
  expect(new Headers(init.headers).get("X-Session-Activity")).toBe("passive");
});

it("hands the started request over exactly once", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}"))));
  runScript("/");
  const early = takeEarly("/api/board");
  expect(early).toBeInstanceOf(Promise);
  expect(takeEarly("/api/board")).toBeUndefined();
  await early;
});
