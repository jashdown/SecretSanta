// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listParticipants } from "~/lib/participants.server";
import { addPeople, HydrateFallback, postRequest, resetDb, routeArgs } from "../../../test/helpers";
import Participants, { action, loader } from "./participants";

beforeEach(resetDb);

const submit = (fields: Record<string, string | number>) =>
  action(routeArgs(postRequest(fields)));

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
