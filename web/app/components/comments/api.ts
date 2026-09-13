import { api } from "~/lib/api";
import type { CommentEntry, CommentsResponse, HeldMine, PostCommentResult } from "~/lib/api-types";

export const commentsKey = (slug: string, token: string | null, initiativeId: string) =>
  ["comments", slug, token ?? "", initiativeId] as const;
export const mineKey = (tokens: string[]) => ["comments-mine", tokens.join(",")] as const;

export const fetchComments = (slug: string) =>
  api<CommentsResponse>(`/api/initiatives/${encodeURIComponent(slug)}/comments`);
export const fetchMine = (tokens: string[]) =>
  api<{ held: HeldMine[] }>(`/api/comments/mine?tokens=${tokens.join(",")}`, { token: null });
export const postComment = (slug: string, body: Record<string, unknown>, token: string | null) =>
  api<PostCommentResult>(`/api/initiatives/${encodeURIComponent(slug)}/comments`, {
    json: body,
    token,
  });
export const vote = (id: string, dir: "up" | "down") =>
  api<{ myvote: number; votes: number }>(`/api/comments/${id}/vote`, { json: { dir } });
export const report = (id: string) =>
  api<{ ok: true }>(`/api/comments/${id}/report`, { method: "POST", token: null });
export interface ReplyResult {
  ok: true;
  status: "published" | "held";
  reply: CommentEntry | null;
  /** Private token for a held reply, so the author can still see it. */
  claimToken: string;
  /** Whether the parent question counts as answered after this reply. */
  answered: boolean;
}
export const reply = (id: string, body: string, name: string, token: string | null) =>
  api<ReplyResult>(`/api/comments/${id}/reply`, { json: { body, name }, token });
export const adminAction = (id: string, action: string) =>
  api<{ comment: unknown }>(`/api/admin/comments/${id}/${action}`, { method: "POST" });
