import { Form, Link, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requireAdmin } from "~/lib/session.server";

// Runs before every loader and action under /admin.
export const middleware: Route.MiddlewareFunction[] = [requireAdmin];

// Having a loader makes client-side navigations hit the server, so the
// middleware above runs on those too.
export async function loader() {
  return null;
}

const TABS = [
  { to: "/admin", label: "Participants", end: true },
  { to: "/admin/assignments", label: "Assignments", end: false },
  { to: "/admin/history", label: "History", end: false },
];

export default function AdminLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 pt-3">
          <Link to="/admin" className="flex items-center gap-2 font-bold">
            <span className="text-2xl" aria-hidden>
              🎅
            </span>
            Patton Secret Santa
          </Link>
          <Form method="post" action="/logout">
            <button className="btn btn-ghost btn-sm">Sign out</button>
          </Form>
        </div>
        <nav className="mx-auto mt-2 flex max-w-4xl gap-1 px-4" aria-label="Admin">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-red-700 text-red-700 dark:border-red-400 dark:text-red-400"
                    : "border-transparent text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
