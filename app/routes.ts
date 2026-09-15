import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/board.tsx"),
  route("initiative/:slug", "routes/initiative.tsx"),
  route("initiative/:slug/edit", "routes/initiative.edit.tsx"),
  route("rfp/:slug", "routes/rfp-redirect.tsx"),
  route("submit", "routes/submit.tsx"),
  route("submit/thanks", "routes/submitted.tsx"),
  route("mine", "routes/mine.tsx"),
  route("donation-terms", "routes/terms.tsx"),
  route("donation-terms/v/:id", "routes/terms.version.tsx"),
  route("admin", "routes/admin.tsx", [
    index("routes/admin.dashboard.tsx"),
    route("initiatives/:slug", "routes/admin.initiative.tsx"),
    route("leads", "routes/admin.leads.tsx"),
  ]),
] satisfies RouteConfig;
