// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDraw, getLatestDraw, sendDrawEmails } from "~/lib/draws.server";
import { deleteParticipant } from "~/lib/participants.server";
import { addPeople, HydrateFallback, postRequest, resetDb, routeArgs } from "../../../test/helpers";
import Assignments, { action, loader } from "./assignments";

const { sendAssignmentEmail } = vi.hoisted(() => ({
  sendAssignmentEmail: vi.fn<typeof import("~/lib/email.server").sendAssignmentEmail>(
    async () => "sent",
  ),
}));
vi.mock("~/lib/email.server", () => ({ sendAssignmentEmail, emailConfigured: false }));

beforeEach(resetDb);
afterEach(() => {
  vi.useRealTimers();
});

const thisYear = () => `Secret Santa ${new Date().getFullYear()}`;
const latest = () => getLatestDraw()!;
const assignmentOf = (giverName: string) =>
  latest().assignments.find((a) => a.giverName === giverName)!;

const submit = (fields: Record<string, string | number>) =>
  action(routeArgs(postRequest(fields)));

/** Makes one person's email fail and everyone else's succeed. */
function failFor(failing: string) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendAssignmentEmail.mockImplementation(async ({ to }) => {
    if (to === failing) throw new Error("Mailbox full");
    return "sent";
  });
}

describe("loader", () => {
  it("has no draw to start with", async () => {
    addPeople("Alice", "Bob");
    expect(await loader()).toEqual({
      participantCount: 2,
      minParticipants: 3,
      draw: null,
      status: null,
      emailConfigured: false,
      defaultName: thisYear(),
    });
  });

  it("returns the latest draw and whether it's up to date", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("Family 2026");
    expect(await loader()).toMatchObject({
      participantCount: 3,
      draw: { name: "Family 2026", assignments: expect.any(Array) },
      status: { upToDate: true, sent: 0, unsent: 3, locked: false },
    });
  });
});

describe("action", () => {
  describe("draw", () => {
    it("needs at least 3 people", async () => {
      addPeople("Alice", "Bob");
      expect(await submit({ intent: "draw", name: "2026" })).toEqual({
        ok: false,
        message: "Add at least 3 participants first.",
      });
      expect(getLatestDraw()).toBeNull();
    });

    it("makes assignments, then redraws them", async () => {
      addPeople("Alice", "Bob", "Carol");
      expect(await submit({ intent: "draw", name: " Family 2026 " })).toEqual({
        ok: true,
        message: "Made assignments for 3 people.",
      });
      expect(latest().name).toBe("Family 2026");

      expect(await submit({ intent: "draw", name: "Family 2026" })).toEqual({
        ok: true,
        message: "Redrew assignments for 3 people.",
      });
    });

    it("names the draw after the current year when left blank", async () => {
      vi.setSystemTime(new Date("2030-12-01T12:00:00Z"));
      addPeople("Alice", "Bob", "Carol");
      await submit({ intent: "draw", name: "   " });
      expect(latest().name).toBe("Secret Santa 2030");
    });

    it("rejects names over 100 characters", async () => {
      addPeople("Alice", "Bob", "Carol");
      expect(await submit({ intent: "draw", name: "x".repeat(101) })).toEqual({
        ok: false,
        message: "Keep the name under 100 characters.",
      });
      expect(getLatestDraw()).toBeNull();
    });
  });

  describe("send", () => {
    beforeEach(() => {
      addPeople("Alice", "Bob", "Carol");
      createDraw("2026");
    });

    const send = (mode = "unsent") => submit({ intent: "send", drawId: latest().id, mode });

    it("emails everyone", async () => {
      expect(await send()).toEqual({ ok: true, message: "Emailed 3 people. 🎉" });
      expect(sendAssignmentEmail).toHaveBeenCalledTimes(3);
    });

    it("refuses when the draw changed after the page loaded", async () => {
      const staleId = latest().id;
      createDraw("2026"); // e.g. a redraw in another tab
      expect(await submit({ intent: "send", drawId: staleId, mode: "unsent" })).toEqual({
        ok: false,
        message: "The assignments changed since this page loaded. Check them and try again.",
      });
      expect(sendAssignmentEmail).not.toHaveBeenCalled();
    });

    it("refuses when people were added or removed since the draw", async () => {
      addPeople("Dave");
      expect(await send()).toEqual({
        ok: false,
        message: "The participant list changed since this draw. Make new assignments first.",
      });
      expect(sendAssignmentEmail).not.toHaveBeenCalled();
    });

    it("explains that nothing was really sent without SMTP", async () => {
      sendAssignmentEmail.mockResolvedValue("logged");
      expect(await send()).toEqual({
        ok: true,
        message:
          "Printed 3 emails to the server console. Nothing was sent because SMTP isn't set up.",
      });
    });

    it("reports when some emails failed", async () => {
      failFor("bob@example.com");
      expect(await send()).toEqual({
        ok: false,
        message: "Emailed 2 people, but 1 email failed. See the list below.",
      });
    });

    it("reports when every email failed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      sendAssignmentEmail.mockRejectedValue(new Error("SMTP is down"));
      expect(await send()).toEqual({ ok: false, message: "3 emails failed. See the list below." });
    });

    it("only retries the people who haven't been emailed", async () => {
      failFor("bob@example.com");
      await send();
      sendAssignmentEmail.mockClear();
      sendAssignmentEmail.mockResolvedValue("sent");

      expect(await send()).toEqual({ ok: true, message: "Emailed 1 person. 🎉" });
      expect(sendAssignmentEmail).toHaveBeenCalledOnce();
    });

    it("says when everyone has already been emailed", async () => {
      await send();
      expect(await send()).toEqual({ ok: true, message: "Everyone has already been emailed." });
    });

    it("resends to everyone when asked", async () => {
      await send();
      sendAssignmentEmail.mockClear();
      expect(await send("all")).toEqual({ ok: true, message: "Emailed 3 people. 🎉" });
      expect(sendAssignmentEmail).toHaveBeenCalledTimes(3);
    });
  });

  describe("resend", () => {
    let people: ReturnType<typeof addPeople>;
    beforeEach(() => {
      people = addPeople("Alice", "Bob", "Carol");
      createDraw("2026");
    });

    const resend = (assignmentId: number) =>
      submit({ intent: "resend", drawId: latest().id, assignmentId });

    it("emails one person", async () => {
      expect(await resend(assignmentOf("Alice").id)).toEqual({
        ok: true,
        message: "Emailed Alice.",
      });
      expect(sendAssignmentEmail).toHaveBeenCalledOnce();
      expect(sendAssignmentEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "alice@example.com" }),
      );
    });

    it("says when the email failed", async () => {
      failFor("alice@example.com");
      expect(await resend(assignmentOf("Alice").id)).toEqual({
        ok: false,
        message: "Couldn't email Alice.",
      });
    });

    it("won't email someone who has been removed", async () => {
      const alice = assignmentOf("Alice");
      deleteParticipant(people[0].id);
      expect(await resend(alice.id)).toEqual({
        ok: false,
        message: "That person is no longer taking part. Make new assignments first.",
      });
      expect(sendAssignmentEmail).not.toHaveBeenCalled();
    });

    it("won't email someone whose person to buy for has been removed", async () => {
      const alice = assignmentOf("Alice");
      deleteParticipant(alice.receiverId!);
      expect(await resend(alice.id)).toMatchObject({ ok: false });
      expect(sendAssignmentEmail).not.toHaveBeenCalled();
    });

    it("won't email an assignment that isn't in the current draw", async () => {
      expect(await resend(999_999)).toMatchObject({ ok: false });
      expect(sendAssignmentEmail).not.toHaveBeenCalled();
    });
  });

  it("rejects anything else", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("2026");
    await expect(submit({ intent: "explode", drawId: latest().id })).rejects.toMatchObject({
      init: { status: 400 },
    });
  });
});

describe("page", () => {
  function renderPage() {
    const Stub = createRoutesStub([
      { path: "/admin/assignments", Component: Assignments, HydrateFallback, loader, action },
    ]);
    render(<Stub initialEntries={["/admin/assignments"]} />);
    return userEvent.setup();
  }

  const rowOf = (giverName: string) =>
    screen.getByText(giverName, { selector: "li p" }).closest("li")!;

  it("asks for more people when there are fewer than 3", async () => {
    addPeople("Alice", "Bob");
    renderPage();
    expect(
      await screen.findByText("You need at least 3 participants to draw names (you have 2)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add people" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("button", { name: /Make assignments/ })).not.toBeInTheDocument();
  });

  it("warns that email isn't set up", async () => {
    renderPage();
    expect(await screen.findByText("Email isn't set up yet.")).toBeInTheDocument();
  });

  it("draws names and keeps pairings hidden until you ask", async () => {
    addPeople("Alice", "Bob", "Carol");
    const user = renderPage();

    expect(await screen.findByLabelText("Name")).toHaveValue(thisYear());
    await user.click(screen.getByRole("button", { name: "Make assignments for 3" }));

    expect(await screen.findByText("Made assignments for 3 people.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: thisYear() })).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 emailed/)).toBeInTheDocument();

    const { assignments } = latest();
    for (const a of assignments) {
      expect(within(rowOf(a.giverName)).getByText("hidden")).toBeInTheDocument();
      expect(rowOf(a.giverName)).not.toHaveTextContent(`gives to ${a.receiverName}`);
      expect(within(rowOf(a.giverName)).getByText("Not sent")).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "Show pairings" }));
    for (const a of assignments) {
      expect(rowOf(a.giverName)).toHaveTextContent(`gives to ${a.receiverName}`);
    }

    await user.click(screen.getByRole("button", { name: "Hide pairings" }));
    expect(within(rowOf("Alice")).getByText("hidden")).toBeInTheDocument();
  });

  it("asks before replacing a draw nobody has been emailed about", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    addPeople("Alice", "Bob", "Carol");
    createDraw("Family 2026");
    const firstId = latest().id;
    const user = renderPage();

    expect(await screen.findByLabelText("Name")).toHaveValue("Family 2026");
    await user.click(screen.getByRole("button", { name: "Redraw" }));
    expect(confirm).toHaveBeenCalledWith("Replace the current assignments with a new draw?");
    expect(latest().id).toBe(firstId);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Redraw" }));
    expect(await screen.findByText("Redrew assignments for 3 people.")).toBeInTheDocument();
    expect(latest().id).not.toBe(firstId);
  });

  it("emails everyone, then offers to resend", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    addPeople("Alice", "Bob", "Carol");
    createDraw("2026");
    const user = renderPage();

    await user.click(await screen.findByRole("button", { name: "Email all 3" }));
    expect(await screen.findByText("Emailed 3 people. 🎉")).toBeInTheDocument();
    expect(screen.getByText(/3 of 3 emailed/)).toBeInTheDocument();
    for (const name of ["Alice", "Bob", "Carol"]) {
      expect(within(rowOf(name)).getByText("Sent")).toBeInTheDocument();
    }

    // Resending to everyone needs a second thought.
    sendAssignmentEmail.mockClear();
    await user.click(screen.getByRole("button", { name: "Resend to everyone" }));
    expect(confirm).toHaveBeenCalledWith(
      "Everyone has already been emailed. Send everyone their assignment again?",
    );
    expect(sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it("shows which emails failed and why", async () => {
    failFor("bob@example.com");
    addPeople("Alice", "Bob", "Carol");
    createDraw("2026");
    const user = renderPage();

    await user.click(await screen.findByRole("button", { name: "Email all 3" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Emailed 2 people, but 1 email failed. See the list below.",
    );
    expect(within(rowOf("Bob")).getByText("Failed")).toBeInTheDocument();
    expect(within(rowOf("Bob")).getByText("Mailbox full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email the 1 not yet sent" })).toBeInTheDocument();
  });

  it("emails one person from their row", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("2026");
    const user = renderPage();
    await screen.findByRole("button", { name: "Email all 3" });

    await user.click(within(rowOf("Bob")).getByRole("button", { name: "Send" }));

    expect(await within(rowOf("Bob")).findByText("Sent")).toBeInTheDocument();
    expect(within(rowOf("Bob")).getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(within(rowOf("Alice")).getByText("Not sent")).toBeInTheDocument();
    expect(sendAssignmentEmail).toHaveBeenCalledOnce();
  });

  it("blocks emailing everyone after the participant list changes", async () => {
    const [, bob] = addPeople("Alice", "Bob", "Carol", "Dave");
    createDraw("2026");
    addPeople("Erin");
    deleteParticipant(bob.id);
    renderPage();

    expect(
      await screen.findByText(
        "The participant list changed since this draw (added Erin) (removed Bob). Make new assignments before emailing everyone.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email all 4" })).toBeDisabled();

    // Bob's row, and the row of whoever was buying for Bob, can't be sent.
    for (const a of latest().assignments) {
      const button = within(rowOf(a.giverName)).getByRole("button", { name: "Send" });
      if (a.giverName === "Bob" || a.receiverName === "Bob") expect(button).toBeDisabled();
      else expect(button).toBeEnabled();
    }
  });

  it("starts a new draw once the last one has been emailed", async () => {
    addPeople("Alice", "Bob", "Carol");
    createDraw("Family 2025");
    await sendDrawEmails(latest(), "all");
    renderPage();

    expect(await screen.findByLabelText("Name")).toHaveValue(thisYear());
    expect(screen.getByRole("button", { name: "Make assignments for 3" })).toBeInTheDocument();
    expect(screen.getByText(/The current one stays in History/)).toBeInTheDocument();
  });
});
