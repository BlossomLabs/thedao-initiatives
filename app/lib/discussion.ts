/**
 * The discussion link on an initiative is a Discourse topic or a Telegram
 * group. The wording follows the host: t.me links open a group chat, anything
 * else a forum thread.
 */
export type DiscussionKind = "forum" | "telegram";

export function discussionKind(url: string): DiscussionKind {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "forum";
  }
  return host === "t.me" || host.endsWith(".t.me") || host === "telegram.me" ? "telegram" : "forum";
}

/** Button text: "Open the group discussion" for Telegram, "Open the forum thread" otherwise. */
export const openDiscussion = (url: string): string =>
  discussionKind(url) === "telegram" ? "Open the group discussion" : "Open the forum thread";

/** Short noun for links inside a sentence or a list. */
export const discussionNoun = (url: string): string =>
  discussionKind(url) === "telegram" ? "group discussion" : "forum thread";
