import { beforeEach, describe, expect, it, vi } from "vitest";
import { addPeople, moveToLastYear, resetDb, restrict } from "../../test/helpers";
import {
  checkDraw,
  createDraw,
  getLatestDraw,
  listDraws,
  resendAssignmentEmail,
  SendError,
  sendDrawEmails,
  type Draw,
} from "./draws.server";
import {
  deleteParticipant,
  listParticipants,
  listRestrictions,
  updateParticipant,
} from "./participants.server";
import { DrawError } from "./assign.server";

const { sendAssignmentEmail } = vi.hoisted(() => ({
  sendAssignmentEmail: vi.fn<typeof import("./email.server").sendAssignmentEmail>(
    async () => "sent",
  ),
}));
vi.mock("./email.server", () => ({ sendAssignmentEmail, emailConfigured: true }));

beforeEach(resetDb);

const latest = () => getLatestDraw()!;
const pairsOf = (draw: Draw) =>
  draw.assignments.map((a) => `${a.giverName} → ${a.receiverName}`).sort();
const find = (draw: Draw, giverName: string) =>
  draw.assignments.find((a) => a.giverName === giverName)!;

const check = () => checkDraw(latest(), listParticipants(), listRestrictions());

/** Makes every email wait until the returned function is called. */
function holdEmails() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  sendAssignmentEmail.mockImplementation(async () => {
    await gate;
    return "sent";
  });
  return release;
}

/** Draws names and emails everyone, so the draw is kept in history. */
async function keptDraw(name: string) {
  createDraw(name);
  await sendDrawEmails(latest().id, "all");
  return latest();
}

describe("createDraw", () => {
  it("gives everyone one person to buy for", () => {
    const people = addPeople("Alice", "Bob", "Carol", "Dave");
    expect(createDraw("Secret Santa 2026")).toEqual({ replaced: false, count: 4, repeats: 0 });

    const draw = latest();
    expect(draw.name).toBe("Secret Santa 2026");
    expect(draw.assignments.map((a) => a.giverId)).toEqual(people.map((p) => p.id));
    expect(draw.assignments.map((a) => a.receiverId).sort()).toEqual(
      people.map((p) => p.id).sort(),
    );
    for (const a of draw.assignments) {
      expect(a.receiverId).not.toBe(a.giverId);
      expect(a).toMatchObject({ emailStatus: "pending", emailError: null, emailedAt: null });
    }
    expect(find(draw, "Alice").giverEmail).toBe("alice@example.com");
  });

  it("leaves the current draw alone if a new one can't be made", () => {
    const [alice] = addPeople("Alice", "Bob", "Carol");
    createDraw("First");
    deleteParticipant(alice.id);

    expect(() => createDraw("Second")).toThrow("Add at least 3 participants first.");
    expect(listDraws().map((d) => d.name)).toEqual(["First"]);
  });

  it("follows everyone's restrictions", () => {
    const [alice, bob, carol, dave] = addPeople("Alice", "Bob", "Carol", "Dave");
    // Two couples, and Alice won't buy for Carol either. Only Alice → Dave →
    // Bob → Carol → Alice fits.
    restrict(alice, bob, carol);
    restrict(bob, alice);
    restrict(carol, dave);
    restrict(dave, carol);

    for (let redraw = 0; redraw < 5; redraw++) {
      createDraw("2026");
      expect(pairsOf(latest())).toEqual([
        "Alice → Dave",
        "Bob → Carol",
        "Carol → Alice",
        "Dave → Bob",
      ]);
    }
  });

  it("leaves the current draw alone when no draw fits the restrictions", () => {
    const [alice, bob] = addPeople("Alice", "Bob", "Carol");
    createDraw("First");
    restrict(alice, bob);
    restrict(bob, alice);

    expect(() => createDraw("Second")).toThrow(DrawError);
    expect(listDraws().map((d) => d.name)).toEqual(["First"]);
  });

  it("replaces the draw while nobody has been emailed", () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("First try");
    expect(createDraw("Second try").replaced).toBe(true);
    expect(listDraws().map((d) => d.name)).toEqual(["Second try"]);
  });

  it("keeps last year's draw even if nobody was emailed about it", () => {
    // e.g. it was handed out from the console previews.
    addPeople("Alice", "Bob", "Carol");
    createDraw("2025");
    moveToLastYear(latest().id);

    expect(createDraw("2026").replaced).toBe(false);
    expect(listDraws().map((d) => d.name)).toEqual(["2026", "2025"]);
  });

  it("still replaces the draw after preview-only sends", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("First try");
    sendAssignmentEmail.mockResolvedValue("logged");
    await sendDrawEmails(latest().id, "all");

    expect(createDraw("Second try").replaced).toBe(true);
    expect(listDraws()).toHaveLength(1);
  });

  it("still replaces the draw when every email failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    addPeople("Alice", "Bob", "Carol");
    createDraw("First try");
    sendAssignmentEmail.mockRejectedValue(new Error("SMTP is down"));
    await sendDrawEmails(latest().id, "all");

    expect(createDraw("Second try").replaced).toBe(true);
    expect(listDraws()).toHaveLength(1);
  });

  it("won't replace the draw while its emails are going out", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("First try");
    const release = holdEmails();
    const sending = sendDrawEmails(latest().id, "all");

    // Nobody has been emailed yet, so without the lock this would replace the
    // draw while its emails kept going out.
    expect(() => createDraw("Second try")).toThrow(
      new DrawError("Emails are still going out. Wait for them to finish, then try again."),
    );

    release();
    expect(await sending).toEqual({ sent: 3, logged: 0, failed: 0 });
    expect(listDraws().map((d) => d.name)).toEqual(["First try"]);
    expect(createDraw("Second try").replaced).toBe(false);
  });

  it("keeps the draw in history once anyone has been emailed", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("2025");
    const draw = latest();
    await resendAssignmentEmail(draw.id, draw.assignments[0].id);

    expect(createDraw("2026").replaced).toBe(false);
    expect(listDraws().map((d) => d.name)).toEqual(["2026", "2025"]);
  });

  it("avoids pairings from the last draw that was emailed", async () => {
    // 3 people can only be drawn two ways, so a draw that avoids last year's
    // pairings has to be the other way round.
    addPeople("Alice", "Bob", "Carol");
    const lastYear = pairsOf(await keptDraw("2025"));

    // Redraws replace each other, but all of them avoid last year.
    for (let redraw = 0; redraw < 5; redraw++) {
      expect(createDraw("2026").repeats).toBe(0);
      const thisYear = pairsOf(latest());
      expect(thisYear.filter((pair) => lastYear.includes(pair))).toEqual([]);
    }

    // Once 2026 is emailed, the next draw avoids 2026 instead.
    await sendDrawEmails(latest().id, "all");
    createDraw("2027");
    expect(pairsOf(latest())).toEqual(lastYear);
  });

  it("keeps removed people's names in past draws", async () => {
    const [alice] = addPeople("Alice", "Bob", "Carol", "Dave");
    await keptDraw("2025");
    deleteParticipant(alice.id);

    const draw = latest();
    expect(draw.assignments).toHaveLength(4);
    expect(find(draw, "Alice")).toMatchObject({ giverId: null, giverEmail: "alice@example.com" });
    const aliceSanta = draw.assignments.find((a) => a.receiverName === "Alice")!;
    expect(aliceSanta.receiverId).toBeNull();
  });

  it("shows people's current names and emails", () => {
    const [alice] = addPeople("Alice", "Bob", "Carol");
    createDraw("2026");
    updateParticipant(alice.id, { name: "Alicia", email: "alicia@example.com" });

    const draw = latest();
    expect(draw.assignments.find((a) => a.giverId === alice.id)).toMatchObject({
      giverName: "Alicia",
      giverEmail: "alicia@example.com",
    });
    expect(draw.assignments.find((a) => a.receiverId === alice.id)?.receiverName).toBe("Alicia");
  });
});

describe("listDraws and getLatestDraw", () => {
  it("return nothing before the first draw", () => {
    expect(listDraws()).toEqual([]);
    expect(getLatestDraw()).toBeNull();
  });

  it("list draws newest first, each with its own assignments", async () => {
    addPeople("Alice", "Bob", "Carol");
    await keptDraw("2025");
    addPeople("Dave");
    createDraw("2026");

    const draws = listDraws();
    expect(draws.map((d) => [d.name, d.assignments.length])).toEqual([
      ["2026", 4],
      ["2025", 3],
    ]);
    for (const draw of draws) {
      expect(draw.assignments.every((a) => a.drawId === draw.id)).toBe(true);
    }
    expect(getLatestDraw()).toEqual(draws[0]);
  });

  it("order assignments by giver name, ignoring case", () => {
    addPeople("carol", "Alice", "bob");
    createDraw("2026");
    expect(latest().assignments.map((a) => a.giverName)).toEqual(["Alice", "bob", "carol"]);
  });
});

describe("checkDraw", () => {
  it("is up to date right after drawing", () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("2026");
    expect(check()).toEqual({
      added: [],
      removed: [],
      restricted: 0,
      upToDate: true,
      sent: 0,
      unsent: 3,
      locked: false,
    });
  });

  it("lists people added since the draw", () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("2026");
    addPeople("Dave");
    expect(check()).toMatchObject({
      added: ["Dave"],
      removed: [],
      upToDate: false,
    });
  });

  it("lists people removed since the draw", () => {
    const [, bob] = addPeople("Alice", "Bob", "Carol", "Dave");
    createDraw("2026");
    deleteParticipant(bob.id);
    expect(check()).toMatchObject({
      added: [],
      removed: ["Bob"],
      upToDate: false,
    });
  });

  it("counts assignments that break a restriction set after the draw", () => {
    const people = addPeople("Alice", "Bob", "Carol", "Dave");
    createDraw("2026");
    const { assignments } = latest();
    const byId = (id: number | null) => people.find((p) => p.id === id)!;

    // Rule out who two of them drew.
    for (const a of assignments.slice(0, 2)) restrict(byId(a.giverId), byId(a.receiverId));
    expect(check()).toMatchObject({ added: [], removed: [], restricted: 2, upToDate: false });

    createDraw("2026");
    expect(check()).toMatchObject({ restricted: 0, upToDate: true });
  });

  it("locks a draw from an earlier year, even if nobody was emailed", () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("2025");
    moveToLastYear(latest().id);
    expect(check()).toMatchObject({ sent: 0, locked: true });
  });

  it("only counts real sends, and locks the draw after the first one", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("2026");

    sendAssignmentEmail.mockResolvedValue("logged");
    await sendDrawEmails(latest().id, "all");
    expect(check()).toMatchObject({
      sent: 0,
      unsent: 3,
      locked: false,
    });

    sendAssignmentEmail.mockResolvedValue("sent");
    await resendAssignmentEmail(latest().id, latest().assignments[0].id);
    expect(check()).toMatchObject({
      sent: 1,
      unsent: 2,
      locked: true,
    });
  });
});

describe("sendDrawEmails", () => {
  beforeEach(() => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("Secret Santa 2026");
  });

  it("emails each giver who they're buying for", async () => {
    const draw = latest();
    expect(await sendDrawEmails(draw.id, "unsent")).toEqual({ sent: 3, logged: 0, failed: 0 });

    expect(sendAssignmentEmail).toHaveBeenCalledTimes(3);
    for (const a of draw.assignments) {
      expect(sendAssignmentEmail).toHaveBeenCalledWith({
        to: a.giverEmail,
        giverName: a.giverName,
        receiverName: a.receiverName,
        drawName: "Secret Santa 2026",
      });
    }
    for (const a of latest().assignments) {
      expect(a).toMatchObject({
        emailStatus: "sent",
        emailError: null,
        emailedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      });
    }
  });

  it("records preview-only sends when SMTP isn't set up", async () => {
    sendAssignmentEmail.mockResolvedValue("logged");
    expect(await sendDrawEmails(latest().id, "unsent")).toEqual({ sent: 0, logged: 3, failed: 0 });
    expect(latest().assignments.map((a) => a.emailStatus)).toEqual(["logged", "logged", "logged"]);
  });

  it("records failures and carries on with everyone else", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    sendAssignmentEmail.mockImplementation(async ({ to }) => {
      if (to === "bob@example.com") throw new Error("Mailbox full");
      return "sent";
    });

    expect(await sendDrawEmails(latest().id, "unsent")).toEqual({ sent: 2, logged: 0, failed: 1 });

    const draw = latest();
    expect(find(draw, "Bob")).toMatchObject({
      emailStatus: "failed",
      emailError: "Mailbox full",
      emailedAt: expect.any(String),
    });
    expect(find(draw, "Alice").emailStatus).toBe("sent");
    expect(find(draw, "Carol").emailStatus).toBe("sent");
    expect(errorLog).toHaveBeenCalledWith("Failed to email bob@example.com: Mailbox full");
  });

  it("saves errors that aren't Error objects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendAssignmentEmail.mockRejectedValue("connection timed out");
    await sendDrawEmails(latest().id, "unsent");
    expect(find(latest(), "Alice").emailError).toBe("connection timed out");
  });

  it("only retries people who haven't been emailed yet", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendAssignmentEmail.mockImplementation(async ({ to }) => {
      if (to === "bob@example.com") throw new Error("Mailbox full");
      return "sent";
    });
    await sendDrawEmails(latest().id, "unsent");

    sendAssignmentEmail.mockClear();
    sendAssignmentEmail.mockResolvedValue("sent");
    expect(await sendDrawEmails(latest().id, "unsent")).toEqual({ sent: 1, logged: 0, failed: 0 });
    expect(sendAssignmentEmail).toHaveBeenCalledOnce();
    expect(sendAssignmentEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "bob@example.com" }),
    );
    expect(find(latest(), "Bob")).toMatchObject({ emailStatus: "sent", emailError: null });
  });

  it("sends nothing once everyone has been emailed, unless asked to resend to all", async () => {
    await sendDrawEmails(latest().id, "unsent");
    sendAssignmentEmail.mockClear();

    expect(await sendDrawEmails(latest().id, "unsent")).toEqual({ sent: 0, logged: 0, failed: 0 });
    expect(sendAssignmentEmail).not.toHaveBeenCalled();

    expect(await sendDrawEmails(latest().id, "all")).toEqual({ sent: 3, logged: 0, failed: 0 });
  });

  it("sends one batch at a time, so a second click doesn't email anyone twice", async () => {
    const first = sendDrawEmails(latest().id, "unsent");
    const second = sendDrawEmails(latest().id, "unsent");

    expect(await first).toEqual({ sent: 3, logged: 0, failed: 0 });
    expect(await second).toEqual({ sent: 0, logged: 0, failed: 0 });
    expect(sendAssignmentEmail).toHaveBeenCalledTimes(3);
  });

  it("refuses a draw that has since been replaced", async () => {
    const staleId = latest().id;
    createDraw("Redrawn");
    await expect(sendDrawEmails(staleId, "unsent")).rejects.toThrow(
      new SendError("The assignments changed since this page loaded. Check them and try again."),
    );
    expect(sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it("refuses once the participant list has changed", async () => {
    addPeople("Dave");
    await expect(sendDrawEmails(latest().id, "unsent")).rejects.toThrow(
      new SendError("The participant list changed since this draw. Make new assignments first."),
    );
    expect(sendAssignmentEmail).not.toHaveBeenCalled();
  });
});

describe("resendAssignmentEmail", () => {
  beforeEach(() => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("Secret Santa 2026");
  });

  it("emails just that person", async () => {
    const draw = latest();
    const carol = find(draw, "Carol");

    expect(await resendAssignmentEmail(draw.id, carol.id)).toEqual({
      giverName: "Carol",
      status: "sent",
    });

    expect(sendAssignmentEmail).toHaveBeenCalledOnce();
    expect(sendAssignmentEmail).toHaveBeenCalledWith({
      to: "carol@example.com",
      giverName: "Carol",
      receiverName: carol.receiverName,
      drawName: "Secret Santa 2026",
    });
    expect(latest().assignments.map((a) => [a.giverName, a.emailStatus])).toEqual([
      ["Alice", "pending"],
      ["Bob", "pending"],
      ["Carol", "sent"],
    ]);
  });

  it("reports a failed send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendAssignmentEmail.mockRejectedValue(new Error("Mailbox full"));
    const draw = latest();
    expect(await resendAssignmentEmail(draw.id, draw.assignments[0].id)).toMatchObject({
      status: "failed",
    });
  });

  it("refuses someone who isn't in the draw", async () => {
    await expect(resendAssignmentEmail(latest().id, 999_999)).rejects.toThrow(
      new SendError("That person is no longer taking part. Make new assignments first."),
    );
    expect(sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it("refuses an assignment that breaks a restriction set since the draw", async () => {
    const people = listParticipants();
    const alice = find(latest(), "Alice");
    const byId = (id: number | null) => people.find((p) => p.id === id)!;
    restrict(byId(alice.giverId), byId(alice.receiverId));

    await expect(resendAssignmentEmail(latest().id, alice.id)).rejects.toThrow(
      new SendError("The restrictions changed since this draw. Make new assignments first."),
    );
    expect(sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it("refuses anyone once someone has been added since the draw", async () => {
    addPeople("Dave");
    await expect(resendAssignmentEmail(latest().id, find(latest(), "Alice").id)).rejects.toThrow(
      new SendError("The participant list changed since this draw. Make new assignments first."),
    );
    expect(sendAssignmentEmail).not.toHaveBeenCalled();
  });
});
