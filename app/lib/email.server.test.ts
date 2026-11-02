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
      auth: { user: "santa", pass: "pw" },
    });
    expect(nodemailer.sendMail).toHaveBeenCalledWith({
      from: "Santa <santa@example.com>",
      to: { name: "Alice", address: "alice@example.com" },
      subject: "🎅 Your Secret Santa assignment — Secret Santa 2026",
      text: expect.stringContaining("You're the Secret Santa for: Bob"),
      html: expect.stringContaining("Bob"),
    });
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
      drawName: "<b>2026</b>",
    });

    const { html, text } = nodemailer.sendMail.mock.calls[0][0];
    expect(html).toContain("&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;");
    expect(html).toContain("Tom &amp; Jerry&#39;s");
    expect(html).toContain("&lt;b&gt;2026&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    // Plain text needs no escaping.
    expect(text).toContain("Tom & Jerry's");
  });

  it("passes send errors on to the caller", async () => {
    const { sendAssignmentEmail } = await loadEmail(smtp);
    nodemailer.sendMail.mockRejectedValue(new Error("Mailbox unavailable"));
    await expect(sendAssignmentEmail(email)).rejects.toThrow("Mailbox unavailable");
  });
});
