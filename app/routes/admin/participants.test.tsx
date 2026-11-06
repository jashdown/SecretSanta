// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteParticipant, listParticipants, listRestrictions } from "~/lib/participants.server";
import {
  addPeople,
  HydrateFallback,
  postRequest,
  resetDb,
  restrict,
  routeArgs,
} from "../../../test/helpers";
import Participants, { action, loader } from "./participants";

beforeEach(resetDb);

const submit = (fields: Record<string, string | number>) =>
  action(routeArgs(postRequest(fields)));

/** An update with restrictions; postRequest can't repeat a field name. */
function submitUpdate(fields: Record<string, string | number>, cantGiveTo: (number | string)[]) {
  const body = new URLSearchParams({ intent: "update" });
  for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
  for (const id of cantGiveTo) body.append("cantGiveTo", String(id));
  return action(routeArgs(new Request("http://localhost/", { method: "POST", body })));
}

describe("action", () => {
  it("adds someone", async () => {
    expect(await submit({ intent: "create", name: " Alice ", email: "Alice@Example.com" })).toEqual(
      { ok: true },
    );
    expect(listParticipants()).toEqual([
      { id: expect.any(Number), name: "Alice", email: "alice@example.com" },
    ]);
  });

  it("returns errors and saves nothing when the form is wrong", async () => {
    expect(await submit({ intent: "create", name: "", email: "nope" })).toMatchObject({
      data: {
        ok: false,
        errors: { name: "Enter a name.", email: "That doesn't look like an email address." },
      },
      init: { status: 400 },
    });
    expect(listParticipants()).toEqual([]);
  });

  it("updates someone, letting them keep their email", async () => {
    const [alice] = addPeople("Alice", "Bob");
    expect(
      await submit({ intent: "update", id: alice.id, name: "Alicia", email: alice.email }),
    ).toEqual({ ok: true });
    expect(listParticipants()).toContainEqual({ ...alice, name: "Alicia" });
  });

  it("won't give someone another person's email", async () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    expect(
      await submit({ intent: "update", id: bob.id, name: "Bob", email: alice.email }),
    ).toMatchObject({
      data: { ok: false, errors: { email: "Alice already uses this email." } },
      init: { status: 400 },
    });
    expect(listParticipants()).toContainEqual(bob);
  });

  it("saves who someone can't give to along with their details", async () => {
    const [alice, bob, carol] = addPeople("Alice", "Bob", "Carol", "Dave");
    expect(
      await submitUpdate({ id: alice.id, name: "Alicia", email: alice.email }, [bob.id, carol.id]),
    ).toEqual({ ok: true });
    expect(listParticipants()).toContainEqual({ ...alice, name: "Alicia" });
    expect(listRestrictions()).toEqual([
      { giverId: alice.id, receiverId: bob.id },
      { giverId: alice.id, receiverId: carol.id },
    ]);
  });

  it("returns every problem at once and saves nothing", async () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    deleteParticipant(bob.id);
    expect(await submitUpdate({ id: alice.id, name: "", email: alice.email }, [bob.id])).toMatchObject({
      data: {
        ok: false,
        errors: {
          name: "Enter a name.",
          cantGiveTo: "Someone you picked has been removed. Pick again.",
        },
      },
      init: { status: 400 },
    });
    expect(listParticipants()).toEqual([alice]);
    expect(listRestrictions()).toEqual([]);
  });

  it("removes someone", async () => {
    const [alice] = addPeople("Alice", "Bob");
    expect(await submit({ intent: "delete", id: alice.id })).toEqual({ ok: true });
    expect(listParticipants().map((p) => p.name)).toEqual(["Bob"]);
  });

  it("rejects anything else", async () => {
    await expect(submit({ intent: "explode" })).rejects.toMatchObject({ init: { status: 400 } });
  });
});

describe("page", () => {
  function renderPage() {
    const Stub = createRoutesStub([
      { path: "/admin", Component: Participants, HydrateFallback, loader, action },
    ]);
    render(<Stub initialEntries={["/admin"]} />);
    return userEvent.setup();
  }

  const rowOf = (name: string) => screen.getByText(name, { selector: "li p" }).closest("li")!;

  it("says when nobody has been added yet", async () => {
    renderPage();
    expect(await screen.findByText("Nobody yet. Add the first person above.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "0 people" })).toBeInTheDocument();
  });

  it("lists everyone", async () => {
    addPeople("Bob", "Alice");
    renderPage();
    expect(await screen.findByRole("heading", { name: "2 people" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("alice@example.com"),
      expect.stringContaining("bob@example.com"),
    ]);
  });

  it("adds someone and clears the form for the next person", async () => {
    const user = renderPage();
    const name = await screen.findByLabelText("Name");
    const email = screen.getByLabelText("Email");

    await user.type(name, "Alice");
    await user.type(email, "alice@example.com");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("heading", { name: "1 person" })).toBeInTheDocument();
    expect(rowOf("Alice")).toHaveTextContent("alice@example.com");
    await waitFor(() => expect(name).toHaveValue(""));
    expect(email).toHaveValue("");
    expect(name).toHaveFocus();
  });

  it("shows the server's error next to the field", async () => {
    addPeople("Alice");
    const user = renderPage();

    await user.type(await screen.findByLabelText("Name"), "Al");
    await user.type(screen.getByLabelText("Email"), "ALICE@example.com");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const email = screen.getByLabelText("Email");
    await waitFor(() => expect(email).toHaveAccessibleDescription("Alice already uses this email."));
    expect(email).toHaveAttribute("aria-invalid", "true");
    // What they typed is kept so they can fix it.
    expect(screen.getByLabelText("Name")).toHaveValue("Al");
    expect(screen.getByRole("heading", { name: "1 person" })).toBeInTheDocument();
  });

  it("edits someone", async () => {
    addPeople("Alice", "Bob");
    const user = renderPage();
    await screen.findByRole("heading", { name: "2 people" });

    await user.click(within(rowOf("Alice")).getByRole("button", { name: "Edit" }));
    const name = screen.getByDisplayValue("Alice");
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "Alicia");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Alicia", { selector: "li p" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(listParticipants().map((p) => p.name)).toEqual(["Alicia", "Bob"]);
  });

  it("shows who each person can't give to", async () => {
    const [alice, bob, carol, dave] = addPeople("Alice", "Bob", "Carol", "Dave", "Erin");
    restrict(alice, dave, carol, bob);
    restrict(bob, alice);
    restrict(carol, dave, alice);
    renderPage();
    await screen.findByRole("heading", { name: "5 people" });

    expect(rowOf("Alice")).toHaveTextContent("Can't give to Bob, Carol, or Dave");
    expect(rowOf("Bob")).toHaveTextContent("Can't give to Alice");
    expect(rowOf("Carol")).toHaveTextContent("Can't give to Alice or Dave");
    expect(rowOf("Dave")).not.toHaveTextContent("Can't give to");
  });

  it("sets who someone can't give to", async () => {
    const [alice, , carol, dave] = addPeople("Alice", "Bob", "Carol", "Dave", "Erin");
    restrict(alice, carol);
    const user = renderPage();
    await screen.findByRole("heading", { name: "5 people" });

    await user.click(within(rowOf("Alice")).getByRole("button", { name: "Edit" }));
    const picker = screen.getByRole("group", { name: "Can't give to" });
    // Everyone but Alice herself, with her current restriction ticked.
    const boxes = within(picker).getAllByRole("checkbox");
    expect(boxes.map((box) => box.closest("label")!.textContent)).toEqual([
      "Bob",
      "Carol",
      "Dave",
      "Erin",
    ]);
    expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toEqual([
      within(picker).getByRole("checkbox", { name: "Carol" }),
    ]);

    await user.click(within(picker).getByRole("checkbox", { name: "Bob" }));
    await user.click(within(picker).getByRole("checkbox", { name: "Dave" }));
    await user.click(within(picker).getByRole("checkbox", { name: "Bob" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(rowOf("Alice")).toHaveTextContent("Can't give to Carol or Dave"));
    expect(listRestrictions()).toEqual([
      { giverId: alice.id, receiverId: carol.id },
      { giverId: alice.id, receiverId: dave.id },
    ]);
  });

  it("won't let someone rule out everyone", async () => {
    addPeople("Alice", "Bob", "Carol");
    const user = renderPage();
    await screen.findByRole("heading", { name: "3 people" });

    await user.click(within(rowOf("Alice")).getByRole("button", { name: "Edit" }));
    const picker = screen.getByRole("group", { name: "Can't give to" });
    await user.click(within(picker).getByRole("checkbox", { name: "Bob" }));
    await user.click(within(picker).getByRole("checkbox", { name: "Carol" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Leave at least one person they can give to.")).toBeInTheDocument();
    expect(picker).toHaveAccessibleDescription(
      "This only works one way. For a couple, set it for both of them. Leave at least one person they can give to.",
    );
    // Still editing, with the boxes as they were.
    expect(within(picker).getByRole("checkbox", { name: "Bob" })).toBeChecked();
    expect(listRestrictions()).toEqual([]);
  });

  it("doesn't offer restrictions when there's nobody else", async () => {
    addPeople("Alice");
    const user = renderPage();
    await screen.findByRole("heading", { name: "1 person" });

    await user.click(within(rowOf("Alice")).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("throws away edits on Cancel or Escape", async () => {
    addPeople("Alice", "Bob", "Carol");
    const user = renderPage();
    await screen.findByRole("heading", { name: "3 people" });

    await user.click(within(rowOf("Alice")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("Alice"), " Smith");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(rowOf("Alice")).toBeInTheDocument();

    await user.click(within(rowOf("Bob")).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByDisplayValue("Bob"), "by");
    await user.keyboard("{Escape}");
    expect(rowOf("Bob")).toBeInTheDocument();

    expect(listParticipants().map((p) => p.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("asks before removing someone", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    addPeople("Alice", "Bob");
    const user = renderPage();
    await screen.findByRole("heading", { name: "2 people" });

    await user.click(within(rowOf("Alice")).getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledWith(
      "Remove Alice? They'll still appear in the history of past draws.",
    );
    expect(listParticipants()).toHaveLength(2);

    confirm.mockReturnValue(true);
    await user.click(within(rowOf("Alice")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("heading", { name: "1 person" })).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(listParticipants().map((p) => p.name)).toEqual(["Bob"]);
  });
});
