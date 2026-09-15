import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./identity";
import { avatarSrc, presetUri } from "./avatar";

const A = "0x839395e20bbB182fa440d08F850E6c7A8f6F0780";

describe("resolveIdentity", () => {
  it("falls back to short address + default picture", () => {
    const id = resolveIdentity(A, { nickname: null, pfp: "", pfpUrl: "" }, {
      name: null,
      avatar: null,
    });
    expect(id.name).toBe("0x8393…0780");
    expect(id.avatar).toBe(avatarSrc(A));
    expect(id.hasName).toBe(false);
    expect(id.hasAvatar).toBe(false);
    expect(id.nameFromEns).toBe(false);
  });
  it("ENS beats the site profile", () => {
    const id = resolveIdentity(
      A,
      { nickname: "Griff", pfp: "preset:3", pfpUrl: "" },
      { name: "griff.eth", avatar: "https://euc.li/griff.eth" },
    );
    expect(id.name).toBe("griff.eth");
    expect(id.avatar).toBe("https://euc.li/griff.eth");
    expect(id.nameFromEns).toBe(true);
    expect(id.avatarFromEns).toBe(true);
    expect(id.nickname).toBe("Griff");
  });
  it("ENS name without avatar uses the site picture", () => {
    const id = resolveIdentity(
      A,
      { nickname: null, pfp: "preset:3", pfpUrl: "" },
      { name: "griff.eth", avatar: null },
    );
    expect(id.name).toBe("griff.eth");
    expect(id.avatar).toBe(presetUri(3));
    expect(id.avatarFromEns).toBe(false);
    expect(id.hasName).toBe(true);
    expect(id.hasAvatar).toBe(true);
  });
  it("uploaded picture wins over a preset; missing profile = nothing set", () => {
    const up = resolveIdentity(
      A,
      { nickname: "x", pfp: "ipfs:cid", pfpUrl: "https://gw/cid" },
      undefined,
    );
    expect(up.avatar).toBe("https://gw/cid");
    expect(up.hasAvatar).toBe(true);
    const none = resolveIdentity(A, undefined, undefined, true);
    expect(none.hasName).toBe(false);
    expect(none.hasAvatar).toBe(false);
    expect(none.loading).toBe(true);
  });
  it("ignores an ENS avatar without a name", () => {
    const id = resolveIdentity(A, undefined, { name: null, avatar: "https://x/y.png" });
    expect(id.ensAvatar).toBeNull();
    expect(id.avatar).toBe(avatarSrc(A));
  });
});
