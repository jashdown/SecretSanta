import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieFrom, expectRedirect } from "../../test/helpers";
import { checkPassword, isAdmin, logIn, logOut, requireAdmin } from "./session.server";

const request = (cookie?: string) =>
  new Request("http://localhost/admin", { headers: cookie ? { Cookie: cookie } : {} });

async function signIn() {
  return cookieFrom(await logIn(request()));
}

/** A fresh copy of session.server, so the wrong-password count starts at zero. */
async function freshSession() {
  vi.resetModules();
  return import("./session.server");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("checkPassword", () => {
  it("accepts the admin password", () => {
    expect(checkPassword("test-password")).toEqual({ ok: true });
  });

  it.each(["", "wrong", "test-passwor", "test-password ", "TEST-PASSWORD"])(
    "rejects %j",
    (attempt) => {
      expect(checkPassword(attempt)).toEqual({ ok: false });
    },
  );

  it("pauses sign-in for everyone after 10 wrong passwords in 15 minutes", async () => {
    const session = await freshSession();
    vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
    for (let i = 0; i < 10; i++) expect(session.checkPassword("guess")).toEqual({ ok: false });

    // Even the right password is refused, or guessing could carry on.
    expect(session.checkPassword("test-password")).toEqual({ ok: false, retryInMinutes: 15 });

    vi.setSystemTime(new Date("2026-12-01T12:14:01Z"));
    expect(session.checkPassword("test-password")).toEqual({ ok: false, retryInMinutes: 1 });

    vi.setSystemTime(new Date("2026-12-01T12:15:00Z"));
    expect(session.checkPassword("test-password")).toEqual({ ok: true });
  });

  it("only counts wrong passwords from the last 15 minutes", async () => {
    const session = await freshSession();
    vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
    for (let i = 0; i < 9; i++) session.checkPassword("guess");

    vi.setSystemTime(new Date("2026-12-01T12:20:00Z"));
    session.checkPassword("typo");
    expect(session.checkPassword("test-password")).toEqual({ ok: true });
  });
});

describe("logIn", () => {
  it("sends you to /admin with a login cookie", async () => {
    const response = expectRedirect(await logIn(request()), "/admin");
    const header = response.headers.get("Set-Cookie")!;
    expect(header).toMatch(/^__secret_santa=/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=604800");
    // Tests run outside production, where the cookie also works over http.
    expect(header).not.toContain("Secure");
  });
});

describe("isAdmin", () => {
  it("is true with the login cookie", async () => {
    expect(await isAdmin(request(await signIn()))).toBe(true);
  });

  it("is false without a cookie", async () => {
    expect(await isAdmin(request())).toBe(false);
  });

  it("is false when the cookie has been tampered with", async () => {
    const cookie = await signIn();
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
    expect(await isAdmin(request(tampered))).toBe(false);
  });

  it("is false for a session someone made up", async () => {
    const forged = `__secret_santa=${btoa(JSON.stringify({ isAdmin: true }))}`;
    expect(await isAdmin(request(forged))).toBe(false);
  });

  it("is false once ADMIN_PASSWORD has changed, signing everyone out", async () => {
    const cookie = await signIn();
    vi.stubEnv("ADMIN_PASSWORD", "a-new-password");
    const session = await freshSession();

    expect(await session.isAdmin(request(cookie))).toBe(false);
    expect(await session.isAdmin(request(cookieFrom(await session.logIn(request()))))).toBe(true);
  });

  it("doesn't put the password in the cookie", async () => {
    const value = decodeURIComponent((await signIn()).split("=")[1]);
    const session = atob(value.split(".")[0]);
    expect(session).not.toContain("test-password");
  });
});

describe("requireAdmin", () => {
  it("sends visitors who aren't signed in to /login", async () => {
    const error = await requireAdmin({ request: request() }).catch((e: unknown) => e);
    expectRedirect(error, "/login");
  });

  it("lets admins through", async () => {
    await expect(requireAdmin({ request: request(await signIn()) })).resolves.toBeUndefined();
  });
});

describe("logOut", () => {
  it("clears the cookie and sends you to /login", async () => {
    const response = expectRedirect(await logOut(request(await signIn())), "/login");
    expect(response.headers.get("Set-Cookie")).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await isAdmin(request(cookieFrom(response)))).toBe(false);
  });
});
