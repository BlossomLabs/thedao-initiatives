import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { IdentityRow } from "./EntryCard";
import type { CommentEntry } from "~/lib/api-types";

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

it("a Badge holder gets the check after the name, not a role chip", () => {
  render(<IdentityRow c={entry(["EXPERT"])} />);
  expect(screen.getByRole("img", { name: "ETHSecurity Badge holder" })).toBeInTheDocument();
  expect(screen.queryByText("Badge holder")).toBeNull();
  expect(screen.queryByText("Expert")).toBeNull();
});

it("the check shows beside two other role chips (the chip cap no longer hides it)", () => {
  render(<IdentityRow c={entry(["PROPOSER", "CURATOR", "EXPERT"])} />);
  expect(screen.getByRole("img", { name: "ETHSecurity Badge holder" })).toBeInTheDocument();
  expect(screen.getByText("Proposer")).toBeInTheDocument();
  expect(screen.getByText("Curator")).toBeInTheDocument();
});

it("no check without the badge", () => {
  render(<IdentityRow c={entry(["DONOR"])} />);
  expect(screen.queryByRole("img", { name: "ETHSecurity Badge holder" })).toBeNull();
});
