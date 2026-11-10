import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { IdentityRow } from "./EntryCard";
import type { CommentEntry } from "~/lib/api-types";
import { dt } from "~/lib/format";

const entry = (roles: string[]): CommentEntry => ({
  id: "c1",
  type: "other",
  topic: "",
  body: "",
  displayName: "Ana",
  address: "",
  roles,
  answered: false,
  reviewed: false,
  accepted: false,
  featured: 0,
  featuredAt: 0,
  votes: 0,
  createdAt: 0,
});

it("a Badge holder gets a Badge holder chip, named in full in its tooltip", () => {
  render(<IdentityRow c={entry(["EXPERT"])} />);
  expect(screen.getByText("Badge holder")).toHaveAttribute("title", "ETHSecurity Badge holder");
  expect(screen.queryByText("Expert")).toBeNull();
});

it("the Badge holder chip shows beside two other role chips (outside their cap)", () => {
  render(<IdentityRow c={entry(["PROPOSER", "CURATOR", "EXPERT"])} />);
  expect(screen.getByText("Badge holder")).toBeInTheDocument();
  expect(screen.getByText("Proposer")).toBeInTheDocument();
  expect(screen.getByText("Curator")).toBeInTheDocument();
});

it("no Badge holder chip without the badge", () => {
  render(<IdentityRow c={entry(["DONOR"])} />);
  expect(screen.queryByText("Badge holder")).toBeNull();
});

it("shows when the comment was posted, the way reviews do", () => {
  const now = Date.now() / 1000;
  const { unmount } = render(<IdentityRow c={{ ...entry([]), createdAt: now - 300 }} />);
  expect(screen.getByText("5 min ago")).toHaveClass("small", "dim");
  unmount();
  render(<IdentityRow c={{ ...entry([]), createdAt: 1_760_000_000 }} />);
  expect(screen.getByText(dt(1_760_000_000))).toBeInTheDocument();
});
