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

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  // Port 465 uses TLS from the start; other ports upgrade with STARTTLS.
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  return {
    host,
    port,
    secure,
    // Refuse to send the password unencrypted if the upgrade is missing, e.g.
    // stripped by someone in the middle. A relay on this machine is exempt.
    requireTls: !secure && !LOOPBACK_HOSTS.includes(host),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  };
}

/** Who emails come from. Real email needs a real sender, so it's required with SMTP. */
function mailFrom(smtp: ReturnType<typeof smtpConfig>) {
  const from = process.env.MAIL_FROM;
  if (from) return from;
  if (smtp) {
    throw new Error(
      "Missing environment variable MAIL_FROM, needed to send email through SMTP_HOST. See .env.example.",
    );
  }
  // Only ever printed in console previews.
  return "Patton Secret Santa <santa@localhost>";
}

const smtp = smtpConfig();

export const env = {
  isProduction,
  adminPassword: required("ADMIN_PASSWORD", "admin"),
  usingDevPassword: !process.env.ADMIN_PASSWORD,
  sessionSecret: required("SESSION_SECRET", "dev-only-session-secret"),
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : isProduction,
  databasePath: process.env.DATABASE_PATH || "data/secret-santa.db",
  smtp,
  mailFrom: mailFrom(smtp),
};
