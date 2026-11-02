import { beforeEach, describe, expect, it, vi } from "vitest";

const VARIABLES = [
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "COOKIE_SECURE",
  "DATABASE_PATH",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SECURE",
  "MAIL_FROM",
];

/** Loads env.server fresh with only the given variables set. */
async function loadEnv(vars: Record<string, string> = {}) {
  for (const name of VARIABLES) vi.stubEnv(name, vars[name]);
  vi.stubEnv("NODE_ENV", vars.NODE_ENV ?? "development");
  vi.resetModules();
  return (await import("./env.server")).env;
}

beforeEach(() => {
  // Keep your .env file out of these tests.
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
});

describe("in development", () => {
  it("falls back to safe defaults", async () => {
    expect(await loadEnv()).toEqual({
      isProduction: false,
      adminPassword: "admin",
      usingDevPassword: true,
      sessionSecret: "dev-only-session-secret",
      cookieSecure: false,
      databasePath: "data/secret-santa.db",
      smtp: null,
      mailFrom: "Secret Santa <santa@localhost>",
    });
  });

  it("uses the values that are set", async () => {
    const env = await loadEnv({
      ADMIN_PASSWORD: "hunter2",
      SESSION_SECRET: "s3cret",
      DATABASE_PATH: "/tmp/santa.db",
      MAIL_FROM: "Santa <santa@example.com>",
    });
    expect(env).toMatchObject({
      adminPassword: "hunter2",
      usingDevPassword: false,
      sessionSecret: "s3cret",
      databasePath: "/tmp/santa.db",
      mailFrom: "Santa <santa@example.com>",
    });
  });
});

describe("in production", () => {
  const secrets = { NODE_ENV: "production", ADMIN_PASSWORD: "hunter2", SESSION_SECRET: "s3cret" };

  it.each(["ADMIN_PASSWORD", "SESSION_SECRET"])("won't start without %s", async (name) => {
    const vars: Record<string, string> = { ...secrets };
    delete vars[name];
    await expect(loadEnv(vars)).rejects.toThrow(`Missing environment variable ${name}`);
  });

  it("only sends the login cookie over HTTPS by default", async () => {
    const env = await loadEnv(secrets);
    expect(env.isProduction).toBe(true);
    expect(env.cookieSecure).toBe(true);
  });

  it("lets COOKIE_SECURE=false allow plain http", async () => {
    expect((await loadEnv({ ...secrets, COOKIE_SECURE: "false" })).cookieSecure).toBe(false);
  });
});

describe("SMTP settings", () => {
  it("are off without SMTP_HOST", async () => {
    expect((await loadEnv({ SMTP_USER: "santa", SMTP_PASS: "pw" })).smtp).toBeNull();
  });

  it("default to port 587 with STARTTLS", async () => {
    const env = await loadEnv({ SMTP_HOST: "smtp.example.com", SMTP_USER: "santa", SMTP_PASS: "pw" });
    expect(env.smtp).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "santa",
      pass: "pw",
    });
  });

  it("use TLS from the start on port 465", async () => {
    const env = await loadEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "465" });
    expect(env.smtp).toMatchObject({ port: 465, secure: true });
  });

  it.each([
    { port: "587", secure: "true", expected: true },
    { port: "465", secure: "false", expected: false },
  ])("let SMTP_SECURE=$secure override port $port", async ({ port, secure, expected }) => {
    const env = await loadEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: port, SMTP_SECURE: secure });
    expect(env.smtp?.secure).toBe(expected);
  });
});
