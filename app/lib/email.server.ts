import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.server";

export const emailConfigured = env.smtp !== null;

let transporter: Transporter | undefined;

function getTransporter() {
  if (!env.smtp) return undefined;
  transporter ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    requireTLS: env.smtp.requireTls,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    // Keep one connection open and reuse it, rather than connecting and
    // signing in again for every email.
    pool: true,
    maxConnections: 1,
  });
  return transporter;
}

type AssignmentEmail = {
  to: string;
  giverName: string;
  receiverName: string;
  /** Links to the receiver's wish lists. Left out of the email when empty. */
  wishlist: string[];
  drawName: string;
};

/**
 * Sends the "you're the Secret Santa for…" email. Without SMTP settings the
 * email is printed to the server console instead and "logged" is returned.
 */
export async function sendAssignmentEmail(email: AssignmentEmail): Promise<"sent" | "logged"> {
  const message = {
    from: env.mailFrom,
    to: { name: email.giverName, address: email.to },
    subject: `🎅 Your Secret Santa assignment — ${email.drawName}`,
    text: renderText(email),
    html: renderHtml(email),
  };

  const transport = getTransporter();
  if (!transport) {
    console.log(
      [
        "",
        "📧 Email preview (SMTP is not configured, so nothing was sent)",
        `   To:      ${email.giverName} <${email.to}>`,
        `   Subject: ${message.subject}`,
        "",
        message.text.replace(/^/gm, "   "),
        "",
      ].join("\n"),
    );
    return "logged";
  }

  await transport.sendMail(message);
  return "sent";
}

const wishlistHeading = (wishlist: string[]) =>
  wishlist.length === 1 ? "Their wish list:" : "Their wish lists:";

function renderText({ giverName, receiverName, wishlist, drawName }: AssignmentEmail) {
  return [
    `Hi ${giverName},`,
    "",
    `You're the Secret Santa for: ${receiverName}`,
    "",
    ...(wishlist.length ? [wishlistHeading(wishlist), ...wishlist, ""] : []),
    `This is for ${drawName}. Keep it a secret! 🤫🎁`,
  ].join("\n");
}

function renderWishlistHtml(wishlist: string[]) {
  if (wishlist.length === 0) return "";
  // Links are checked to be http(s) when they're saved, so they're safe in href.
  const items = wishlist.map((link) => {
    const safe = escapeHtml(link);
    return `
          <li style="margin:0 0 4px;word-break:break-all"><a href="${safe}" style="color:#b91c1c">${safe}</a></li>`;
  });
  return `
        <p style="margin:0 0 8px">${wishlistHeading(wishlist)}</p>
        <ul style="margin:0 0 24px;padding-left:20px">${items.join("")}
        </ul>`;
}

function renderHtml({ giverName, receiverName, wishlist, drawName }: AssignmentEmail) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e5e4">
      <div style="background:#b91c1c;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:600">🎅 ${escapeHtml(drawName)}</div>
      <div style="padding:24px">
        <p style="margin:0 0 16px">Hi ${escapeHtml(giverName)},</p>
        <p style="margin:0 0 8px">You're the Secret Santa for:</p>
        <p style="margin:0 0 24px;font-size:28px;font-weight:700;color:#047857">${escapeHtml(receiverName)}</p>${renderWishlistHtml(wishlist)}
        <p style="margin:0;color:#57534e">Keep it a secret! 🤫🎁</p>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
