import { discussionKind, discussionNoun, openDiscussion } from "./discussion";

describe("discussion link wording", () => {
  it("telegram groups are t.me links", () => {
    expect(discussionKind("https://t.me/+PHZekKhdjPAxOWU0")).toBe("telegram");
    expect(discussionKind("https://t.me/thatsrekt_alerts")).toBe("telegram");
    expect(discussionKind("https://telegram.me/somegroup")).toBe("telegram");
    expect(openDiscussion("https://t.me/+abc")).toBe("Open the group discussion");
    expect(discussionNoun("https://t.me/+abc")).toBe("group discussion");
  });

  it("everything else is a forum thread", () => {
    expect(discussionKind("https://forum.example.org/t/my-initiative/123")).toBe("forum");
    expect(discussionKind("https://discuss.ens.domains/t/x/22079")).toBe("forum");
    expect(discussionKind("not a url")).toBe("forum");
    expect(openDiscussion("https://forum.example.org/t/x/1")).toBe("Open the forum thread");
    expect(discussionNoun("https://forum.example.org/t/x/1")).toBe("forum thread");
  });

  it("does not mistake a look-alike host for telegram", () => {
    expect(discussionKind("https://not-t.me/x")).toBe("forum");
    expect(discussionKind("https://t.me.example.org/x")).toBe("forum");
  });
});
