/** Shared fixtures for the vitest suites. */
import type { Initiative } from "~/lib/api-types";

/** A pending structured grant as the API answers its proposer (private fields included). */
export const structuredRow = (): Initiative => ({
  id: "1",
  slug: "audit-tooling",
  title: "Audit tooling for rollups",
  summary: "A summary long enough to satisfy the forty character minimum of the rule.",
  details: "",
  discourseUrl: "https://forum.example.org/t/audit-tooling/12",
  goalUsd: 150_000,
  status: "pending",
  type: "grant",
  sortRank: null,
  safeAddress: "",
  proposer: "0x1111111111111111111111111111111111111111",
  durationMonths: 12,
  recipientTeam: "Rollup Labs",
  recipientUrl: "https://rollup.example",
  topup: false,
  milestoneReviewer: "",
  sections: {
    why: "why",
    team: "team",
    why_grant: "why grant",
    in_scope: "in",
    out_scope: "out",
    commitments: "commit",
  },
  milestones: [
    {
      name: "Only milestone",
      amount: 150_000,
      adoption: true,
      done: false,
      link: "",
      month: "",
      criteria: ["Something a reviewer can check"],
    },
  ],
  links: ["https://github.com/example/repo"],
  structured: true,
  revision: 2,
  createdAt: 0,
  approvedAt: null,
  funders: "Ethereum Foundation | yes",
  contact: "me@example.org",
});
