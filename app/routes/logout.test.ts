import { describe, expect, it } from "vitest";
import { expectRedirect, postRequest, routeArgs } from "../../test/helpers";
import { action, loader } from "./logout";

describe("logout", () => {
  it("clears the login cookie and sends you to /login", async () => {
    const response = expectRedirect(await action(routeArgs(postRequest({}))), "/login");
    expect(response.headers.get("Set-Cookie")).toMatch(/^__secret_santa=;/);
  });

  it("only signs out on POST, so a link or prefetch can't do it", async () => {
    const error = await loader().catch((e: unknown) => e);
    expectRedirect(error, "/");
  });
});
