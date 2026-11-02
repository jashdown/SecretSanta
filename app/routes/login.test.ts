import { describe, expect, it, vi } from "vitest";
import { isAdmin } from "~/lib/session.server";
import { cookieFrom, expectRedirect, postRequest, routeArgs } from "../../test/helpers";
import { action, loader } from "./login";

const getLogin = (url = "http://localhost/login", headers: Record<string, string> = {}) =>
  routeArgs(new Request(url, { headers }));

async function signIn() {
  const response = await action(routeArgs(postRequest({ password: "test-password" })));
  return cookieFrom(response as Response);
}

describe("loader", () => {
  it("sends admins who are already signed in to /admin", async () => {
    const cookie = await signIn();
    const error = await loader(getLogin(undefined, { Cookie: cookie })).catch((e: unknown) => e);
    expectRedirect(error, "/admin");
  });

  it("hides the dev password hint once ADMIN_PASSWORD is set", async () => {
    expect(await loader(getLogin())).toEqual({ usingDevPassword: false, needsHttps: false });
  });

  describe("when the login cookie is HTTPS-only", () => {
    async function secureLoader() {
      vi.stubEnv("COOKIE_SECURE", "true");
      vi.resetModules();
      return (await import("./login")).loader;
    }

    it.each<{ url: string; headers: Record<string, string>; needsHttps: boolean }>([
      { url: "http://192.168.1.20:3000/login", headers: {}, needsHttps: true },
      { url: "http://santa.home/login", headers: {}, needsHttps: true },
      { url: "https://santa.example.com/login", headers: {}, needsHttps: false },
      {
        url: "http://santa.example.com/login",
        headers: { "X-Forwarded-Proto": "https" },
        needsHttps: false,
      },
      { url: "http://localhost:5173/login", headers: {}, needsHttps: false },
      { url: "http://127.0.0.1:3000/login", headers: {}, needsHttps: false },
      { url: "http://[::1]:3000/login", headers: {}, needsHttps: false },
    ])("needsHttps is $needsHttps for $url $headers", async ({ url, headers, needsHttps }) => {
      const load = await secureLoader();
      expect(await load(getLogin(url, headers))).toMatchObject({ needsHttps });
    });
  });
});

describe("action", () => {
  it.each<Record<string, string>>([{ password: "wrong" }, {}])("rejects %j", async (fields) => {
    const result = await action(routeArgs(postRequest(fields)));
    expect(result).toMatchObject({
      data: { error: "That password isn't right." },
      init: { status: 401 },
    });
  });

  it("signs you in with the right password", async () => {
    const response = await action(routeArgs(postRequest({ password: "test-password" })));
    expectRedirect(response, "/admin");
    const cookie = cookieFrom(response as Response);
    expect(await isAdmin(new Request("http://localhost/", { headers: { Cookie: cookie } }))).toBe(
      true,
    );
  });
});
