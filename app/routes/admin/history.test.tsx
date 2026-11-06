// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDraw, getLatestDraw, sendDrawEmails, type Draw } from "~/lib/draws.server";
import { createParticipant, deleteParticipant } from "~/lib/participants.server";
import { addPeople, HydrateFallback, resetDb } from "../../../test/helpers";
import History, { loader } from "./history";

const { sendAssignmentEmail } = vi.hoisted(() => ({
  sendAssignmentEmail: vi.fn<typeof import("~/lib/email.server").sendAssignmentEmail>(
    async () => "sent",
  ),
}));
vi.mock("~/lib/email.server", () => ({ sendAssignmentEmail, emailConfigured: true }));

beforeEach(resetDb);

/** Draws names and emails everyone, so the draw is kept in history. */
async function keptDraw(name: string) {
  createDraw(name);
  await sendDrawEmails(getLatestDraw()!.id, "all");
  return getLatestDraw()!;
}

const receiverOf = (draw: Draw, giverName: string) =>
  draw.assignments.find((a) => a.giverName === giverName)!.receiverName;

describe("loader", () => {
  it("is empty before the first draw", async () => {
    expect(await loader()).toEqual({ draws: [], people: [] });
  });

  it("builds a table of who each person gave to in each draw", async () => {
    const [, , carol] = addPeople("Alice", "Bob", "Carol");
    const first = await keptDraw("2025");
    deleteParticipant(carol.id);
    addPeople("Dave");
    createDraw("2026");
    const second = getLatestDraw()!;

    const { draws, people } = await loader();

    expect(draws.map((d) => d.name)).toEqual(["2026", "2025"]);
    expect(people).toEqual([
      {
        key: "alice@example.com",
        name: "Alice",
        receivers: {
          [first.id]: receiverOf(first, "Alice"),
          [second.id]: receiverOf(second, "Alice"),
        },
      },
      {
        key: "bob@example.com",
        name: "Bob",
        receivers: {
          [first.id]: receiverOf(first, "Bob"),
          [second.id]: receiverOf(second, "Bob"),
        },
      },
      { key: "carol@example.com", name: "Carol", receivers: { [first.id]: receiverOf(first, "Carol") } },
      { key: "dave@example.com", name: "Dave", receivers: { [second.id]: receiverOf(second, "Dave") } },
    ]);
  });

  it("keeps someone who left and came back on one row, under their latest name", async () => {
    const [, , carol] = addPeople("Alice", "Bob", "Carol");
    const first = await keptDraw("2025");
    deleteParticipant(carol.id);
    createParticipant({ name: "Caroline", email: "carol@example.com" });
    createDraw("2026");
    const second = getLatestDraw()!;

    const { people } = await loader();

    expect(people.map((p) => p.name)).toEqual(["Alice", "Bob", "Caroline"]);
    expect(people[2].receivers).toEqual({
      [first.id]: receiverOf(first, "Carol"),
      [second.id]: receiverOf(second, "Caroline"),
    });
  });
});

describe("page", () => {
  function renderPage() {
    const Stub = createRoutesStub([
      { path: "/admin/history", Component: History, HydrateFallback, loader },
    ]);
    render(<Stub initialEntries={["/admin/history"]} />);
  }

  /** The collapsible card for one draw. */
  const cardOf = (drawName: string) =>
    screen.getByText(drawName, { selector: "summary p" }).closest("details")!;

  it("points to the assignments page before the first draw", async () => {
    renderPage();
    expect(await screen.findByText(/No draws yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make the first assignments" })).toHaveAttribute(
      "href",
      "/admin/assignments",
    );
  });

  it("shows every draw, newest first, with who gave to whom", async () => {
    addPeople("Alice", "Bob", "Carol");
    const first = await keptDraw("2025");
    addPeople("Dave");
    createDraw("2026");
    const second = getLatestDraw()!;
    renderPage();

    await screen.findByRole("heading", { name: "History" });

    expect(within(cardOf("2026")).getByText("Current")).toBeInTheDocument();
    expect(cardOf("2026")).toHaveTextContent("4 people · not emailed");
    expect(within(cardOf("2025")).queryByText("Current")).not.toBeInTheDocument();
    expect(cardOf("2025")).toHaveTextContent("3 people · 3 emailed");
    const pairings = within(cardOf("2025")).getAllByRole("listitem");
    expect(pairings.map((li) => li.textContent)).toEqual(
      first.assignments.map((a) => `${a.giverName}→gives to${a.receiverName}`),
    );

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Person",
      "2026",
      "2025",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
      ["Alice", receiverOf(second, "Alice"), receiverOf(first, "Alice")],
      ["Bob", receiverOf(second, "Bob"), receiverOf(first, "Bob")],
      ["Carol", receiverOf(second, "Carol"), receiverOf(first, "Carol")],
      ["Dave", receiverOf(second, "Dave"), "—"],
    ]);
  });
});
