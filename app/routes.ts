import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/board.tsx"),
  route("initiative/:slug", "routes/initiative.tsx"),
  route("initiative/:slug/edit", "routes/initiative.edit.tsx"),
  route("rfp/:slug", "routes/rfp-redirect.tsx"),
  route("submit", "routes/submit.tsx"),
  route("submit/thanks", "routes/submitted.tsx"),
  route("mine", "routes/mine.tsx"),
  route("sessions", "routes/sessions.tsx"),
  // Each ballot has two pages: the one that counts (its path), and the editor (/edit).
  // One route each, so going between them keeps the page (and an example's send).
  route("vote/ballot/edit?", "routes/vote.ballot.tsx"),
  route("vote/mock/:id/edit?", "routes/vote.mock.tsx"),
  route("vote/:code/edit?", "routes/vote.code.tsx"),
  route("devcon/:code", "routes/code-redirect.tsx"),
  route("vote", "routes/vote.tsx"),
  route("donation-terms", "routes/terms.tsx"),
  route("donation-terms/v/:id", "routes/terms.version.tsx"),
  route("admin", "routes/admin.tsx", [
    index("routes/admin.dashboard.tsx"),
    route("initiatives/:slug", "routes/admin.initiative.tsx"),
    route("leads", "routes/admin.leads.tsx"),
    route("maintenance", "routes/admin.maintenance.tsx"),
    route("vote", "routes/admin.vote.tsx"),
  ]),
] satisfies RouteConfig;
