import { beforeEach, describe, expect, it } from "vitest";
import { addPeople, formData, resetDb, restrict } from "../../test/helpers";
import {
  createParticipant,
  deleteParticipant,
  listParticipants,
  listRestrictions,
  parseParticipantForm,
  parseRestrictionsForm,
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
    expect(alice).toEqual({
      id: expect.any(Number),
      name: "Alice",
      email: "alice@example.com",
      wishlist: [],
    });

    updateParticipant(alice.id, {
      name: "Alicia",
      email: "alicia@example.com",
      wishlist: ["https://www.amazon.com/hz/wishlist/ls/ABC", "https://www.elfster.com/"],
    });
    expect(listParticipants()).toEqual([
      {
        id: alice.id,
        name: "Alicia",
        email: "alicia@example.com",
        wishlist: ["https://www.amazon.com/hz/wishlist/ls/ABC", "https://www.elfster.com/"],
      },
    ]);

    deleteParticipant(alice.id);
    expect(listParticipants()).toEqual([]);
  });

  it("can start someone off with a wish list", () => {
    createParticipant({ name: "Alice", email: "alice@example.com", wishlist: ["https://a.example/"] });
    expect(listParticipants()[0].wishlist).toEqual(["https://a.example/"]);
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
      value: { name: "Alice Smith", email: "alice@example.com", wishlist: [] },
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
    expect(result).toEqual({
      ok: true,
      value: { name: "Alicia", email: "alice@example.com", wishlist: [] },
    });
  });

  it("won't let someone take another person's email when editing", () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    const result = parseParticipantForm(formData({ name: "Bob", email: alice.email }), bob.id);
    expect(result).toEqual({ ok: false, errors: { email: "Alice already uses this email." } });
  });
});

describe("parseParticipantForm wish list", () => {
  const parse = (wishlist: string) =>
    parseParticipantForm(formData({ name: "Alice", email: "alice@example.com", wishlist }));

  it("reads one link per line, skipping blank lines", () => {
    expect(
      parse(
        "  https://www.amazon.com/hz/wishlist/ls/ABC123?ref_=wl_share \r\n\r\n" +
          "http://www.elfster.com/wishlist/42/\n   \n",
      ),
    ).toMatchObject({
      ok: true,
      value: {
        wishlist: [
          "https://www.amazon.com/hz/wishlist/ls/ABC123?ref_=wl_share",
          "http://www.elfster.com/wishlist/42/",
        ],
      },
    });
  });

  it("is empty when left blank or left out", () => {
    expect(parse("  \n ")).toMatchObject({ ok: true, value: { wishlist: [] } });
    expect(
      parseParticipantForm(formData({ name: "Alice", email: "alice@example.com" })),
    ).toMatchObject({ ok: true, value: { wishlist: [] } });
  });

  it("adds https:// when it's left off", () => {
    expect(parse("amazon.com/hz/wishlist/ls/ABC\nwww.elfster.com")).toMatchObject({
      ok: true,
      value: { wishlist: ["https://amazon.com/hz/wishlist/ls/ABC", "https://www.elfster.com/"] },
    });
  });

  it("keeps each link once", () => {
    expect(parse("https://a.example/list\nhttps://a.example/list\na.example/list")).toMatchObject({
      ok: true,
      value: { wishlist: ["https://a.example/list"] },
    });
  });

  it.each([
    ["Amazon", 1],
    ["https://a.example/\nmy amazon list", 2],
    ["https://a.example/\n\njavascript:alert(document.cookie)", 3],
    ["ftp://files.example.com/list", 1],
    ["mailto:santa@example.com", 1],
    ["https://www.amazon.com@evil.example/list", 1],
    [`https://a.example/${"x".repeat(2000)}`, 1],
  ])("says which line isn't a web link in %j", (wishlist, line) => {
    expect(parse(wishlist)).toEqual({
      ok: false,
      errors: { wishlist: `Line ${line} doesn't look like a web link.` },
    });
  });

  it("allows up to 10 links", () => {
    const links = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://a.example/${i}`).join("\n");
    expect(parse(links(10))).toMatchObject({ ok: true });
    expect(parse(links(11))).toEqual({
      ok: false,
      errors: { wishlist: "Keep it to 10 links or fewer." },
    });
  });

  it("is reported along with other problems", () => {
    expect(parseParticipantForm(formData({ name: "", email: "a@example.com", wishlist: "nope" })))
      .toEqual({
        ok: false,
        errors: { name: "Enter a name.", wishlist: "Line 1 doesn't look like a web link." },
      });
  });
});

describe("restrictions", () => {
  it("are empty to start with", () => {
    addPeople("Alice", "Bob");
    expect(listRestrictions()).toEqual([]);
  });

  it("are saved with the rest of someone's details, replacing the old ones", () => {
    const [alice, bob, carol] = addPeople("Alice", "Bob", "Carol");
    updateParticipant(alice.id, alice, [carol.id, bob.id]);
    // Sorted by the receiver's name.
    expect(listRestrictions()).toEqual([
      { giverId: alice.id, receiverId: bob.id },
      { giverId: alice.id, receiverId: carol.id },
    ]);

    updateParticipant(alice.id, alice, [carol.id]);
    expect(listRestrictions()).toEqual([{ giverId: alice.id, receiverId: carol.id }]);

    updateParticipant(alice.id, alice, []);
    expect(listRestrictions()).toEqual([]);
  });

  it("are left alone when only the name and email change", () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    restrict(alice, bob);
    updateParticipant(alice.id, { ...alice, name: "Alicia" });
    expect(listRestrictions()).toEqual([{ giverId: alice.id, receiverId: bob.id }]);
  });

  it("only go one way", () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    restrict(alice, bob);
    expect(listRestrictions()).toEqual([{ giverId: alice.id, receiverId: bob.id }]);
  });

  it("go away with either person", () => {
    const [alice, bob, carol] = addPeople("Alice", "Bob", "Carol");
    restrict(alice, bob);
    restrict(bob, carol);
    restrict(carol, alice);

    deleteParticipant(bob.id);
    expect(listRestrictions()).toEqual([{ giverId: carol.id, receiverId: alice.id }]);
  });

  it("can be as many as you like", () => {
    // Alice can still give to Erin.
    const [alice, bob, carol, dave] = addPeople("Alice", "Bob", "Carol", "Dave", "Erin");
    restrict(alice, bob, carol, dave);
    expect(listRestrictions()).toEqual([
      { giverId: alice.id, receiverId: bob.id },
      { giverId: alice.id, receiverId: carol.id },
      { giverId: alice.id, receiverId: dave.id },
    ]);
  });

  it("aren't saved for someone removed in the meantime", () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    deleteParticipant(alice.id);
    updateParticipant(alice.id, alice, [bob.id]);
    expect(listRestrictions()).toEqual([]);
  });

  it("won't let someone be restricted from themselves", () => {
    const [alice] = addPeople("Alice");
    expect(() => updateParticipant(alice.id, alice, [alice.id])).toThrow(/CHECK/);
  });

  it("save nothing when part of the update fails", () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    expect(() =>
      updateParticipant(alice.id, { ...alice, name: "Alicia" }, [bob.id, 999_999]),
    ).toThrow(/FOREIGN KEY/);
    expect(listParticipants().map((p) => p.name)).toEqual(["Alice", "Bob"]);
    expect(listRestrictions()).toEqual([]);
  });
});

describe("parseRestrictionsForm", () => {
  const form = (...ids: (number | string)[]) => {
    const data = new FormData();
    for (const id of ids) data.append("cantGiveTo", String(id));
    return data;
  };

  it("reads everyone picked, ignoring blank values", () => {
    const [alice, bob, carol, dave] = addPeople("Alice", "Bob", "Carol", "Dave", "Erin");
    expect(parseRestrictionsForm(form(bob.id, carol.id, dave.id), alice.id)).toEqual({
      ok: true,
      value: [bob.id, carol.id, dave.id],
    });
    expect(parseRestrictionsForm(form("", bob.id), alice.id)).toEqual({
      ok: true,
      value: [bob.id],
    });
    expect(parseRestrictionsForm(form("", ""), alice.id)).toEqual({ ok: true, value: [] });
    expect(parseRestrictionsForm(new FormData(), alice.id)).toEqual({ ok: true, value: [] });
  });

  it("counts the same person picked twice once", () => {
    const [alice, bob] = addPeople("Alice", "Bob", "Carol");
    expect(parseRestrictionsForm(form(bob.id, bob.id), alice.id)).toEqual({
      ok: true,
      value: [bob.id],
    });
  });

  it("ignores someone picking themselves", () => {
    const [alice, bob] = addPeople("Alice", "Bob", "Carol");
    expect(parseRestrictionsForm(form(alice.id, bob.id), alice.id)).toEqual({
      ok: true,
      value: [bob.id],
    });
  });

  it("won't rule out everyone, or there'd be nobody left to give to", () => {
    const [alice, bob, carol, dave] = addPeople("Alice", "Bob", "Carol", "Dave");
    expect(parseRestrictionsForm(form(bob.id, carol.id, dave.id), alice.id)).toEqual({
      ok: false,
      errors: { cantGiveTo: "Leave at least one person they can give to." },
    });
    expect(parseRestrictionsForm(form(bob.id, carol.id), alice.id)).toMatchObject({ ok: true });
  });

  it("is happy with no restrictions when someone has nobody else", () => {
    const [alice] = addPeople("Alice");
    expect(parseRestrictionsForm(new FormData(), alice.id)).toEqual({ ok: true, value: [] });
  });

  it("notices when someone picked has since been removed", () => {
    const [alice, bob] = addPeople("Alice", "Bob");
    deleteParticipant(bob.id);
    expect(parseRestrictionsForm(form(bob.id), alice.id)).toEqual({
      ok: false,
      errors: { cantGiveTo: "Someone you picked has been removed. Pick again." },
    });
    expect(parseRestrictionsForm(form("nonsense"), alice.id)).toMatchObject({ ok: false });
  });
});
