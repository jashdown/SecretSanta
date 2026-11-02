import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts because the React Router plugin isn't meant
// to run under Vitest.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    setupFiles: ["./test/setup.ts"],
    // Fixed settings so your .env and shell don't change test results. An
    // empty value means "not set" to the app, and stops .env filling it in.
    env: {
      ADMIN_PASSWORD: "test-password",
      SESSION_SECRET: "test-session-secret",
      COOKIE_SECURE: "",
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_SECURE: "",
      MAIL_FROM: "",
    },
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
  },
});
