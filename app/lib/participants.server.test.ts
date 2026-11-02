import { beforeEach, describe, expect, it } from "vitest";
import { addPeople, formData, resetDb } from "../../test/helpers";
import {
  createParticipant,
  deleteParticipant,
  listParticipants,
  parseParticipantForm,
  updateParticipant,
} from "./participants.server";

beforeEach(resetDb);

describe("listParticipants", () => {
  it("is empty to start with", () => {
    expect(listParticipants()).toEqual([]);
  });

  it("sorts by name, ignoring case", () => {
    createParticipant({ name: "bob", email: "bob@example.com" });
    createParticipant({ name: "Carol", email: "carol@example.com" });
    createParticipant({ name: "alice", email: "alice@example.com" });
    expect(listParticipants().map((p) => p.name)).toEqual(["alice", "bob", "Carol"]);
  });
});

describe("create, update and delete", () => {
  it("saves, changes and removes a person", () => {
    createParticipant({ name: "Alice", email: "alice@example.com" });
    const [alice] = listParticipants();
    expect(alice).toEqual({ id: expect.any(Number), name: "Alice", email: "alice@example.com" });

    updateParticipant(alice.id, { name: "Alicia", email: "alicia@example.com" });
    expect(listParticipants()).toEqual([
      { id: alice.id, name: "Alicia", email: "alicia@example.com" },
    ]);

    deleteParticipant(alice.id);
    expect(listParticipants()).toEqual([]);
  });

  it("never reuses an id after someone is removed", () => {
    const [alice] = addPeople("Alice");
    deleteParticipant(alice.id);
    const [bob] = addPeople("Bob");
    expect(bob.id).toBeGreaterThan(alice.id);
  });

  it("won't store the same email twice, whatever the case", () => {
    createParticipant({ name: "Alice", email: "alice@example.com" });
    expect(() => createParticipant({ name: "Imposter", email: "ALICE@example.com" })).toThrow(
      /UNIQUE/,
    );
  });
});

describe("parseParticipantForm", () => {
  it("trims the name and email and lowercases the email", () => {
    const result = parseParticipantForm(
      formData({ name: "  Alice Smith ", email: " Alice@Example.COM  " }),
    );
    expect(result).toEqual({
      ok: true,
      value: { name: "Alice Smith", email: "alice@example.com" },
    });
  });

  it("asks for both fields when they're missing", () => {
    expect(parseParticipantForm(new FormData())).toEqual({
      ok: false,
      errors: { name: "Enter a name.", email: "Enter an email address." },
    });
  });

  it("treats a name of only spaces as missing", () => {
    const result = parseParticipantForm(formData({ name: "   ", email: "a@example.com" }));
    expect(result).toEqual({ ok: false, errors: { name: "Enter a name." } });
  });

  it("allows names up to 100 characters", () => {
    const ok = parseParticipantForm(formData({ name: "a".repeat(100), email: "a@example.com" }));
    expect(ok.ok).toBe(true);

    const tooLong = parseParticipantForm(formData({ name: "a".repeat(101), email: "a@example.com" }));
    expect(tooLong).toEqual({
      ok: false,
      errors: { name: "Keep the name under 100 characters." },
    });
  });

  it.each(["alice", "alice@", "@example.com", "alice@example", "al ice@example.com"])(
    "rejects the email %j",
    (email) => {
      const result = parseParticipantForm(formData({ name: "Alice", email }));
      expect(result).toEqual({
        ok: false,
        errors: { email: "That doesn't look like an email address." },
      });
    },
  );

  it("says who already uses an email, whatever the case", () => {
    addPeople("Alice");
    const result = parseParticipantForm(formData({ name: "Al", email: "ALICE@example.com" }));
    expect(result).toEqual({ ok: false, errors: { email: "Alice already uses this email." } });
  });

  it("lets someone keep their own email when editing", () => {
    const [alice] = addPeople("Alice");
    const result = parseParticipantForm(
      formData({ name: "Alicia", email: "alice@example.com" }),
      alice.id,
    );
    expect(result).toEqual({ ok: true, value: { name: "Alicia", email: "alice@example.com" } });
  });

  it("won't let someone take another person's email when editing", () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    const result = parseParticipantForm(formData({ name: "Bob", email: alice.email }), bob.id);
    expect(result).toEqual({ ok: false, errors: { email: "Alice already uses this email." } });
  });
});
