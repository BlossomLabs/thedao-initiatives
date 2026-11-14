import { afterEach, expect, it, vi } from "vitest";
import { EARLY_FETCH_SCRIPT, takeEarly } from "./early-fetch";
import { SESSION_KEY } from "./session-key";

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.__early;
  localStorage.clear();
});

/** Run the head script the way the browser does: before any module, on the current URL. */
function runScript(pathname: string) {
  globalThis.history.replaceState(null, "", pathname);
  new Function(EARLY_FETCH_SCRIPT)();
}

it("starts the board request on the board page, as the app would send it", () => {
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

it("a request that fails before the app loads is held quietly until the app takes it", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
  runScript("/");
  // Give the browser its chance to report an unhandled rejection (it must not).
  await new Promise((r) => setTimeout(r, 0));
  await expect(takeEarly("/api/board")).rejects.toThrow("offline");
});

it("an anonymous read never takes the early request, which carried the cookie", async () => {
  const { api } = await import("./api");
  const fetchMock = vi.fn(() => Promise.resolve(Response.json({ own: true })));
  vi.stubGlobal("fetch", fetchMock);
  globalThis.__early = {
    "/api/board": { p: Promise.resolve(Response.json({ early: true })), anonymous: false },
  };
  await expect(api("/api/board", { anonymous: true })).resolves.toEqual({ own: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(globalThis.__early["/api/board"]).toBeDefined();
  await expect(api("/api/board")).resolves.toEqual({ early: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

const remember = (expiresAt: number) =>
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ address: "0xabc", isAdmin: false, expiresAt }),
  );

it("on an initiative's page, starts that initiative without the cookie when no one is signed in", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  runScript("/initiative/safe-lockdown-guard");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/initiatives/safe-lockdown-guard");
  expect(init.credentials).toBe("omit");
  expect(new Headers(init.headers).get("X-Session-Activity")).toBe("passive");
  // The app's anonymous read takes it; a read with the cookie doesn't.
  expect(takeEarly("/api/initiatives/safe-lockdown-guard")).toBeUndefined();
  expect(takeEarly("/api/initiatives/safe-lockdown-guard", true)).toBeInstanceOf(Promise);
});

it("with a remembered session, sends the cookie; an expired one counts as signed out", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  remember(Date.now() / 1000 + 3600);
  runScript("/initiative/safe-lockdown-guard/");
  expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe(
    "include",
  );
  expect(takeEarly("/api/initiatives/safe-lockdown-guard", true)).toBeUndefined();
  expect(takeEarly("/api/initiatives/safe-lockdown-guard")).toBeInstanceOf(Promise);
  remember(Date.now() / 1000 - 60);
  runScript("/initiative/safe-lockdown-guard");
  expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].credentials).toBe(
    "omit",
  );
});

it("starts nothing on other pages, an initiative's editor included", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  for (const path of ["/submit", "/initiative/x/edit", "/initiative/", "/vote"]) runScript(path);
  expect(fetchMock).not.toHaveBeenCalled();
});
