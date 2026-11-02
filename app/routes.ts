import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/participants.tsx"),
    route("assignments", "routes/admin/assignments.tsx"),
    route("history", "routes/admin/history.tsx"),
  ]),
] satisfies RouteConfig;
