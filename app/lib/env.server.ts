import { existsSync } from "node:fs";

// Load .env if present. Variables already set in the shell win.
if (existsSync(".env")) process.loadEnvFile(".env");

const isProduction = process.env.NODE_ENV === "production";

/** Required in production; falls back to a dev-only value otherwise. */
function required(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(
      `Missing environment variable ${name}. See .env.example for the full list.`,
    );
  }
  return devFallback;
}

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host,
    port,
    // Port 465 uses TLS from the start; other ports upgrade with STARTTLS.
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === "true"
      : port === 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  };
}

export const env = {
  isProduction,
  adminPassword: required("ADMIN_PASSWORD", "admin"),
  usingDevPassword: !process.env.ADMIN_PASSWORD,
  sessionSecret: required("SESSION_SECRET", "dev-only-session-secret"),
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : isProduction,
  databasePath: process.env.DATABASE_PATH || "data/secret-santa.db",
  smtp: smtpConfig(),
  mailFrom: process.env.MAIL_FROM || "Patton Secret Santa <santa@localhost>",
};
