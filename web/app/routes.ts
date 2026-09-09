import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/board.tsx"),
  route("initiative/:slug", "routes/initiative.tsx"),
  route("rfp/:slug", "routes/rfp-redirect.tsx"),
  route("submit", "routes/submit.tsx"),
  route("submit/thanks", "routes/submitted.tsx"),
  route("donation-terms", "routes/terms.tsx"),
  route("admin", "routes/admin.tsx", [
    index("routes/admin.index.tsx"),
    route("dashboard", "routes/admin.dashboard.tsx"),
    route("initiatives/:id", "routes/admin.initiative.tsx"),
    route("leads", "routes/admin.leads.tsx"),
  ]),
] satisfies RouteConfig;
