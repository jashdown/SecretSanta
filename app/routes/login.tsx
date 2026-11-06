import { data, Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { env } from "~/lib/env.server";
import { checkPassword, isAdmin, logIn } from "~/lib/session.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign in · Patton Secret Santa" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await isAdmin(request)) throw redirect("/admin");

  // Browsers drop Secure cookies over plain HTTP (except on localhost), which
  // would bounce a correct password straight back here with no explanation.
  const url = new URL(request.url);
  const plainHttp =
    url.protocol === "http:" &&
    request.headers.get("X-Forwarded-Proto") !== "https" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

  return {
    usingDevPassword: env.usingDevPassword,
    needsHttps: env.cookieSecure && plainHttp,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  if (!checkPassword(String(form.get("password") ?? ""))) {
    return data({ error: "That password isn't right." }, { status: 401 });
  }
  return logIn(request);
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const submitting = useNavigation().state === "submitting";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 block text-center text-4xl" aria-label="Home">
          🎅
        </Link>
        <Form method="post" className="card space-y-4 p-6">
          <div>
            <h1 className="text-xl font-bold">Organizer sign in</h1>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              Enter the admin password to manage the exchange.
            </p>
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
              required
              autoFocus
              aria-invalid={actionData?.error ? true : undefined}
              aria-describedby={actionData?.error ? "password-error" : undefined}
            />
            {actionData?.error && (
              <p id="password-error" className="field-error">
                {actionData.error}
              </p>
            )}
          </div>
          <button className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
          {loaderData.needsHttps && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              This page was loaded over plain HTTP, so your browser will drop the sign-in cookie
              and bring you back here. Serve the app over HTTPS, or set{" "}
              <code className="font-mono">COOKIE_SECURE=false</code>.
            </p>
          )}
          {loaderData.usingDevPassword && (
            <p className="text-center text-xs text-stone-500">
              Dev mode: the password is <code className="font-mono">admin</code> until you set
              ADMIN_PASSWORD.
            </p>
          )}
        </Form>
      </div>
    </main>
  );
}
