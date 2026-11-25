import { beforeEach, describe, expect, it, vi } from "vitest";

const nodemailer = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport: nodemailer.createTransport } }));

const email = {
  to: "alice@example.com",
  giverName: "Alice",
  receiverName: "Bob",
  wishlist: [] as string[],
  drawName: "Secret Santa 2026",
};

/** Loads email.server fresh with the given settings. */
async function loadEmail(vars: Record<string, string> = {}) {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.resetModules();
  return import("./email.server");
}

describe("without SMTP", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints the email to the console instead of sending it", async () => {
    const { emailConfigured, sendAssignmentEmail } = await loadEmail();

    expect(emailConfigured).toBe(false);
    await expect(sendAssignmentEmail(email)).resolves.toBe("logged");

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    const printed = String(log.mock.calls[0][0]);
    expect(printed).toContain("SMTP is not configured");
    expect(printed).toContain("To:      Alice <alice@example.com>");
    expect(printed).toContain("Subject: 🎅 Your Secret Santa assignment — Secret Santa 2026");
    expect(printed).toContain("You're the Secret Santa for: Bob");
  });
});

describe("with SMTP", () => {
  const smtp = {
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_USER: "santa",
    SMTP_PASS: "pw",
    MAIL_FROM: "Santa <santa@example.com>",
  };

  it("sends the assignment", async () => {
    const { emailConfigured, sendAssignmentEmail } = await loadEmail(smtp);

    expect(emailConfigured).toBe(true);
    await expect(sendAssignmentEmail(email)).resolves.toBe("sent");

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "santa", pass: "pw" },
      pool: true,
      maxConnections: 1,
    });
    expect(nodemailer.sendMail).toHaveBeenCalledWith({
      from: "Santa <santa@example.com>",
      to: { name: "Alice", address: "alice@example.com" },
      subject: "🎅 Your Secret Santa assignment — Secret Santa 2026",
      text: expect.stringContaining("You're the Secret Santa for: Bob"),
      html: expect.stringContaining("Bob"),
    });
  });

  it("insists on STARTTLS when the connection doesn't start encrypted", async () => {
    const { sendAssignmentEmail } = await loadEmail({ ...smtp, SMTP_PORT: "587" });
    await sendAssignmentEmail(email);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
    );
  });

  it("skips auth when there's no SMTP_USER", async () => {
    const { sendAssignmentEmail } = await loadEmail({ ...smtp, SMTP_USER: "", SMTP_PASS: "" });
    await sendAssignmentEmail(email);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it("reuses one connection for every email", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    await sendAssignmentEmail(email);
    await sendAssignmentEmail({ ...email, to: "bob@example.com", giverName: "Bob" });
    expect(nodemailer.createTransport).toHaveBeenCalledOnce();
    expect(nodemailer.sendMail).toHaveBeenCalledTimes(2);
  });

  it("escapes names in the HTML version", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    await sendAssignmentEmail({
      to: "x@example.com",
      giverName: `<script>alert("hi")</script>`,
      receiverName: "Tom & Jerry's",
      wishlist: [`https://a.example/?q="><script>&x='1'`],
      drawName: "<b>2026</b>",
    });

    const { html, text } = nodemailer.sendMail.mock.calls[0][0];
    expect(html).toContain("&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;");
    expect(html).toContain("Tom &amp; Jerry&#39;s");
    expect(html).toContain("&lt;b&gt;2026&lt;/b&gt;");
    expect(html).toContain(
      `href="https://a.example/?q=&quot;&gt;&lt;script&gt;&amp;x=&#39;1&#39;"`,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    // Plain text needs no escaping.
    expect(text).toContain("Tom & Jerry's");
  });

  it("lists the receiver's wish list links", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    const wishlist = [
      "https://www.amazon.com/hz/wishlist/ls/ABC123?ref_=wl_share&type=wishlist",
      "https://www.elfster.com/wishlist/42/",
    ];
    await sendAssignmentEmail({ ...email, wishlist });

    const { html, text } = nodemailer.sendMail.mock.calls[0][0];
    expect(text).toBe(
      [
        "Hi Alice,",
        "",
        "You're the Secret Santa for: Bob",
        "",
        "Their wish lists:",
        "https://www.amazon.com/hz/wishlist/ls/ABC123?ref_=wl_share&type=wishlist",
        "https://www.elfster.com/wishlist/42/",
        "",
        "This is for Secret Santa 2026. Keep it a secret! 🤫🎁",
      ].join("\n"),
    );
    expect(html).toContain("Their wish lists:");
    expect(html).toContain(
      `<a href="https://www.amazon.com/hz/wishlist/ls/ABC123?ref_=wl_share&amp;type=wishlist"`,
    );
    expect(html).toContain(`<a href="https://www.elfster.com/wishlist/42/"`);
  });

  it("says \"wish list\" for a single link", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    await sendAssignmentEmail({ ...email, wishlist: ["https://www.elfster.com/wishlist/42/"] });
    const { html, text } = nodemailer.sendMail.mock.calls[0][0];
    expect(text).toContain("Their wish list:\nhttps://www.elfster.com/wishlist/42/\n");
    expect(html).toContain("Their wish list:");
  });

  it("leaves the wish list out when there isn't one", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    await sendAssignmentEmail(email);
    const { html, text } = nodemailer.sendMail.mock.calls[0][0];
    expect(text).toBe(
      [
        "Hi Alice,",
        "",
        "You're the Secret Santa for: Bob",
        "",
        "This is for Secret Santa 2026. Keep it a secret! 🤫🎁",
      ].join("\n"),
    );
    expect(html).not.toContain("wish list");
    expect(html).not.toContain("<ul");
  });

  it("says an update is an update, and that the person hasn't changed", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    await sendAssignmentEmail({
      ...email,
      wishlist: ["https://www.elfster.com/wishlist/42/"],
      update: true,
    });

    const { subject, html, text } = nodemailer.sendMail.mock.calls[0][0];
    expect(subject).toBe("🎅 Secret Santa wish list update — Secret Santa 2026");
    expect(text).toBe(
      [
        "Hi Alice,",
        "",
        "Here's your assignment again with their latest wish list. You're still buying for the same person.",
        "",
        "You're the Secret Santa for: Bob",
        "",
        "Their wish list:",
        "https://www.elfster.com/wishlist/42/",
        "",
        "This is for Secret Santa 2026. Keep it a secret! 🤫🎁",
      ].join("\n"),
    );
    expect(html).toContain("Here's your assignment again");
    expect(html).toContain(`<a href="https://www.elfster.com/wishlist/42/"`);
  });

  it("says there's no wish list in an update, in case it was just cleared", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    await sendAssignmentEmail({ ...email, update: true });
    const { html, text } = nodemailer.sendMail.mock.calls[0][0];
    expect(text).toContain("You're the Secret Santa for: Bob\n\nThey don't have a wish list right now.\n");
    expect(html).toContain("They don't have a wish list right now.");
  });

  it("passes send errors on to the caller", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    nodemailer.sendMail.mockRejectedValue(new Error("Mailbox unavailable"));
    await expect(sendAssignmentEmail(email)).rejects.toThrow("Mailbox unavailable");
  });
});
