import { createHash, timingSafeEqual } from "node:crypto";
import { createCookieSessionStorage, redirect } from "react-router";
import { env } from "./env.server";

const storage = createCookieSessionStorage<{ isAdmin: boolean }>({
  cookie: {
    name: "__secret_santa",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: env.cookieSecure,
    secrets: [env.sessionSecret],
    maxAge: 60 * 60 * 24 * 7, // a week
  },
});

export async function isAdmin(request: Request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return session.get("isAdmin") === true;
}

export function checkPassword(attempt: string) {
  // Hash both sides so the comparison takes the same time whatever the length.
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(attempt), hash(env.adminPassword));
}

export async function logIn(request: Request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  session.set("isAdmin", true);
  return redirect("/admin", {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function logOut(request: Request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/login", {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

/** Route middleware: sends anyone who isn't signed in to the login page. */
export async function requireAdmin({ request }: { request: Request }) {
  if (!(await isAdmin(request))) throw redirect("/login");
}
