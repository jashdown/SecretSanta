import { describe, expect, it, vi } from "vitest";
import { logIn } from "~/lib/session.server";
import { cookieFrom, expectRedirect, routeArgs } from "../../../test/helpers";
import { middleware } from "./layout";

// This middleware runs before every loader and action under /admin.
describe("admin middleware", () => {
  const [guard] = middleware;
  const next = vi.fn(async () => new Response());

  it("sends visitors who aren't signed in to /login", async () => {
    const request = new Request("http://localhost/admin/assignments");
    const error = await Promise.resolve(guard(routeArgs(request), next)).catch((e: unknown) => e);
    expectRedirect(error, "/login");
    expect(next).not.toHaveBeenCalled();
  });

  it("lets admins through", async () => {
    const cookie = cookieFrom(await logIn(new Request("http://localhost/login")));
    const request = new Request("http://localhost/admin/assignments", {
      headers: { Cookie: cookie },
    });
    await expect(Promise.resolve(guard(routeArgs(request), next))).resolves.toBeUndefined();
  });
});
