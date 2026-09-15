import { describe, expect, it, vi } from "vitest";
import { legacyToken, migrateLegacySession, SESSION_KEY } from "./session-migration";

const legacy = JSON.stringify({
  token: "abc123",
  address: "0x1111111111111111111111111111111111111111",
  isAdmin: false,
  expiresAt: 2_000_000_000,
});

function storage(initial: string | null) {
  const m = new Map<string, string>();
  if (initial !== null) m.set(SESSION_KEY, initial);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: () => m.get(SESSION_KEY) ?? null,
  };
}

describe("legacyToken", () => {
  it("reads the token of a pre-cookie record and nothing else", () => {
    expect(legacyToken(legacy)).toBe("abc123");
    expect(legacyToken(JSON.stringify({ address: "0x1", expiresAt: 1 }))).toBe("");
    expect(legacyToken(JSON.stringify({ token: 42 }))).toBe("");
    expect(legacyToken("not json")).toBe("");
    expect(legacyToken(null)).toBe("");
  });
});

describe("migrateLegacySession", () => {
  it("does nothing without a legacy token", async () => {
    const f = vi.fn();
    const st = storage(JSON.stringify({ address: "0x1", isAdmin: false, expiresAt: 1 }));
    expect(await migrateLegacySession(st, f)).toEqual({ kind: "none" });
    expect(f).not.toHaveBeenCalled();
    expect(await migrateLegacySession(storage(null), f)).toEqual({ kind: "none" });
  });

  it("sends the bearer once and saves the record without it", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          address: "0x1111111111111111111111111111111111111111",
          isAdmin: true,
          expiresAt: 2_000_000_000,
        }),
        { status: 200 },
      ),
    );
    const st = storage(legacy);
    const r = await migrateLegacySession(st, f);
    expect(r.kind).toBe("migrated");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/cookie$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer abc123");
    const saved = JSON.parse(st.raw()!);
    expect(saved).toEqual({
      address: "0x1111111111111111111111111111111111111111",
      isAdmin: true,
      expiresAt: 2_000_000_000,
    });
    expect("token" in saved).toBe(false);
  });

  it("clears the record when the API no longer knows the token", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const st = storage(legacy);
    expect(await migrateLegacySession(st, f)).toEqual({ kind: "cleared" });
    expect(st.raw()).toBeNull();
  });

  it("leaves the record alone on a network or server error", async () => {
    const st = storage(legacy);
    const down = vi.fn().mockRejectedValue(new TypeError("offline"));
    expect(await migrateLegacySession(st, down)).toEqual({ kind: "retry" });
    const broken = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    expect(await migrateLegacySession(st, broken)).toEqual({ kind: "retry" });
    expect(st.raw()).toBe(legacy);
  });
});
