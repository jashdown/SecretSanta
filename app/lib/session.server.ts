import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createCookieSessionStorage, redirect } from "react-router";
import { env } from "./env.server";

// Saved in the session at sign-in. It changes whenever ADMIN_PASSWORD does, so
// changing the password signs everyone out. It's keyed with the session
// secret because anyone holding the cookie can read it, and it mustn't help
// them guess the password.
const passwordStamp = createHmac("sha256", env.sessionSecret)
  .update(env.adminPassword)
  .digest("base64url");

const storage = createCookieSessionStorage<{ passwordStamp: string }>({
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
  return session.get("passwordStamp") === passwordStamp;
}

// The app can't see visitors' IP addresses, so wrong passwords are limited
// for everyone at once: plenty for someone mistyping, far too few for a script
// guessing passwords. The app runs as one server process, so memory is enough.
const MAX_WRONG_PASSWORDS = 10;
const WRONG_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
let wrongPasswordTimes: number[] = [];

/**
 * Checks a sign-in attempt. After too many wrong passwords every attempt is
 * refused for a while, right or wrong, and `retryInMinutes` says how long.
 */
export function checkPassword(attempt: string): { ok: boolean; retryInMinutes?: number } {
  const now = Date.now();
  wrongPasswordTimes = wrongPasswordTimes.filter(
    (time) => now - time < WRONG_PASSWORD_WINDOW_MS,
  );
  if (wrongPasswordTimes.length >= MAX_WRONG_PASSWORDS) {
    const retryAt = wrongPasswordTimes[0] + WRONG_PASSWORD_WINDOW_MS;
    return { ok: false, retryInMinutes: Math.ceil((retryAt - now) / 60_000) };
  }

  // Hash both sides so the comparison takes the same time whatever the length.
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (timingSafeEqual(hash(attempt), hash(env.adminPassword))) return { ok: true };
  wrongPasswordTimes.push(now);
  return { ok: false };
}

export async function logIn(request: Request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  session.set("passwordStamp", passwordStamp);
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
