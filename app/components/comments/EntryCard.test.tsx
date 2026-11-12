import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import EntryCard from "./EntryCard";
import type { CommentEntry } from "~/lib/api-types";
import { dt } from "~/lib/format";

vi.mock("~/context/wallet", () => ({ useWallet: () => ({ address: undefined }) }));
vi.mock("~/context/session", () => ({ useSession: () => ({ connecting: false }) }));
vi.mock("~/hooks/use-identity", () => ({ useIdentity: () => ({ name: "" }) }));
vi.mock("~/components/wallet/ConnectInline", () => ({ default: () => null }));

const entry = (id: string, createdAt: number, replies?: CommentEntry[]): CommentEntry => ({
  id,
  type: "other",
  topic: "",
  body: "Body of " + id,
  displayName: "Ana",
  address: "",
  roles: [],
  answered: false,
  reviewed: false,
  accepted: false,
  featured: 0,
  featuredAt: 0,
  votes: 0,
  createdAt,
  replies,
});

it("a comment and each of its replies show when they were posted", () => {
  const comment = 1_760_000_000;
  const reply = 1_760_900_000;
  render(
    <EntryCard
      c={entry("c1", comment, [entry("r1", reply)])}
      canVote={false}
      isAdmin={false}
      connected={false}
      onVote={vi.fn()}
      onReply={vi.fn()}
      onReport={vi.fn()}
      onAdmin={vi.fn()}
    />,
  );
  expect(screen.getByText(dt(comment))).toBeInTheDocument();
  expect(screen.getByText(dt(reply))).toBeInTheDocument();
});
