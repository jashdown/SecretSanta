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
  /** Links to the giver's own wish lists, with a reminder to keep them up to date. Left out when empty. */
  ownWishlist: string[];
  drawName: string;
  /** Sent again so they have the latest wish list: says so, and that the person hasn't changed. */
  update?: boolean;
};

const UPDATE_INTRO =
  "Here's your assignment again with their latest wish list. You're still buying for the same person.";
const NO_WISHLIST = "They don't have a wish list right now.";

/**
 * Sends the "you're the Secret Santa for…" email. Without SMTP settings the
 * email is printed to the server console instead and "logged" is returned.
 */
export async function sendAssignmentEmail(email: AssignmentEmail): Promise<"sent" | "logged"> {
  const message = {
    from: env.mailFrom,
    to: { name: email.giverName, address: email.to },
    subject: email.update
      ? `🎅 Secret Santa wish list update — ${email.drawName}`
      : `🎅 Your Secret Santa assignment — ${email.drawName}`,
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

const ownWishlistReminder = (ownWishlist: string[]) =>
  `Don't forget to keep your own wish ${ownWishlist.length === 1 ? "list" : "lists"} up to date, so your Santa knows what you'd like:`;

function renderText({
  giverName,
  receiverName,
  wishlist,
  ownWishlist,
  drawName,
  update,
}: AssignmentEmail) {
  return [
    `Hi ${giverName},`,
    "",
    ...(update ? [UPDATE_INTRO, ""] : []),
    `You're the Secret Santa for: ${receiverName}`,
    "",
    ...(wishlist.length
      ? [wishlistHeading(wishlist), ...wishlist, ""]
      : update
        ? [NO_WISHLIST, ""]
        : []),
    ...(ownWishlist.length ? [ownWishlistReminder(ownWishlist), ...ownWishlist, ""] : []),
    `This is for ${drawName}. Keep it a secret! 🤫🎁`,
  ].join("\n");
}

function renderLinksHtml(links: string[], indent: string) {
  // Links are checked to be http(s) when they're saved, so they're safe in href.
  return links
    .map((link) => {
      const safe = escapeHtml(link);
      return `
${indent}  <li style="margin:0 0 4px;word-break:break-all"><a href="${safe}" style="color:#b91c1c">${safe}</a></li>`;
    })
    .join("");
}

function renderWishlistHtml(wishlist: string[], update = false) {
  if (wishlist.length === 0) {
    return update ? `
        <p style="margin:0 0 24px">${NO_WISHLIST}</p>` : "";
  }
  return `
        <p style="margin:0 0 8px">${wishlistHeading(wishlist)}</p>
        <ul style="margin:0 0 24px;padding-left:20px">${renderLinksHtml(wishlist, "        ")}
        </ul>`;
}

/** Boxed off so it isn't mistaken for the list of the person they're buying for. */
function renderOwnWishlistHtml(ownWishlist: string[]) {
  if (ownWishlist.length === 0) return "";
  return `
        <div style="margin:0 0 24px;padding:16px;background:#f5f5f4;border-radius:12px;font-size:14px">
          <p style="margin:0 0 8px">${ownWishlistReminder(ownWishlist)}</p>
          <ul style="margin:0;padding-left:20px">${renderLinksHtml(ownWishlist, "          ")}
          </ul>
        </div>`;
}

function renderHtml({
  giverName,
  receiverName,
  wishlist,
  ownWishlist,
  drawName,
  update,
}: AssignmentEmail) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e5e4">
      <div style="background:#b91c1c;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:600">🎅 ${escapeHtml(drawName)}</div>
      <div style="padding:24px">
        <p style="margin:0 0 16px">Hi ${escapeHtml(giverName)},</p>${update ? `
        <p style="margin:0 0 16px">${UPDATE_INTRO}</p>` : ""}
        <p style="margin:0 0 8px">You're the Secret Santa for:</p>
        <p style="margin:0 0 24px;font-size:28px;font-weight:700;color:#047857">${escapeHtml(receiverName)}</p>${renderWishlistHtml(wishlist, update)}${renderOwnWishlistHtml(ownWishlist)}
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
