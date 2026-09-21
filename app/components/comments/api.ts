import { api } from "~/lib/api";
import type {
  CommentEntry,
  CommentExperts,
  CommentsResponse,
  HeldMine,
  PostCommentResult,
} from "~/lib/api-types";

export const commentsKey = (slug: string, who: string | null, initiativeId: string) =>
  ["comments", slug, who ?? "", initiativeId] as const;
export const expertsKey = (slug: string, who: string | null, initiativeId: string) =>
  ["comment-experts", slug, who ?? "", initiativeId] as const;
export const mineKey = (scope: string) => ["comments-mine", scope] as const;

export const fetchComments = (slug: string, signal?: AbortSignal, anonymous = false) =>
  api<CommentsResponse>(`/api/initiatives/${encodeURIComponent(slug)}/comments`, {
    signal,
    anonymous,
  });
/** The badge lookups go to the chain, so they travel apart from the list. */
export const fetchExperts = (slug: string, signal?: AbortSignal, anonymous = false) =>
  api<CommentExperts>(`/api/initiatives/${encodeURIComponent(slug)}/comments/experts`, {
    signal,
    anonymous,
  });
export const fetchMine = (tokens: string[], signal?: AbortSignal) =>
  api<{ held: HeldMine[] }>("/api/comments/mine", { json: { tokens }, signal, anonymous: true });
export const postComment = (slug: string, body: Record<string, unknown>) =>
  api<PostCommentResult>(`/api/initiatives/${encodeURIComponent(slug)}/comments`, {
    json: body,
  });
export const vote = (id: string, dir: "up" | "down") =>
  api<{ myvote: number; votes: number }>(`/api/comments/${id}/vote`, { json: { dir } });
export const report = (id: string) =>
  api<{ ok: true }>(`/api/comments/${id}/report`, { method: "POST" });
export interface ReplyResult {
  ok: true;
  status: "published" | "held";
  reply: CommentEntry | null;
  /** Private token for a held reply, so the author can still see it. */
  claimToken: string;
  /** Whether the parent question counts as answered after this reply. */
  answered: boolean;
}
export const reply = (id: string, body: string, name: string) =>
  api<ReplyResult>(`/api/comments/${id}/reply`, { json: { body, name } });
export const adminAction = (id: string, action: string) =>
  api<{ comment: unknown }>(`/api/admin/comments/${id}/${action}`, { method: "POST" });
