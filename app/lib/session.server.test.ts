import { describe, expect, it } from "vitest";
import { cookieFrom, expectRedirect } from "../../test/helpers";
import { checkPassword, isAdmin, logIn, logOut, requireAdmin } from "./session.server";

const request = (cookie?: string) =>
  new Request("http://localhost/admin", { headers: cookie ? { Cookie: cookie } : {} });

async function signIn() {
  return cookieFrom(await logIn(request()));
}

describe("checkPassword", () => {
  it("accepts the admin password", () => {
    expect(checkPassword("test-password")).toBe(true);
  });

  it.each(["", "wrong", "test-passwor", "test-password ", "TEST-PASSWORD"])(
    "rejects %j",
    (attempt) => {
      expect(checkPassword(attempt)).toBe(false);
    },
  );
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
