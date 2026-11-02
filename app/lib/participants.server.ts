import { all, get, run, transaction } from "./db.server";

/** How many people each person can be kept from buying for. */
export const MAX_RESTRICTIONS = 2;

export type Participant = { id: number; name: string; email: string };

/** The giver must never be given the receiver to buy for. */
export type Restriction = { giverId: number; receiverId: number };

export type ParticipantErrors = { name?: string; email?: string; cantGiveTo?: string };

type ParseResult =
  | { ok: true; value: { name: string; email: string } }
  | { ok: false; errors: ParticipantErrors };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function listParticipants(): Participant[] {
  return all<Participant>(
    "SELECT id, name, email FROM participants ORDER BY name COLLATE NOCASE",
  );
}

/** Validates name/email from a form. Pass `id` when editing so the person doesn't clash with themselves. */
export function parseParticipantForm(form: FormData, id?: number): ParseResult {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const errors: ParticipantErrors = {};

  if (!name) errors.name = "Enter a name.";
  else if (name.length > 100) errors.name = "Keep the name under 100 characters.";

  if (!email) errors.email = "Enter an email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "That doesn't look like an email address.";
  else {
    const taken = get<{ name: string }>(
      "SELECT name FROM participants WHERE email = ? AND id IS NOT ?",
      email,
      id ?? null,
    );
    if (taken) errors.email = `${taken.name} already uses this email.`;
  }

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { name, email } };
}

export function createParticipant({ name, email }: { name: string; email: string }) {
  run("INSERT INTO participants (name, email) VALUES (?, ?)", name, email);
}

/** Pass `cantGiveTo` to replace who this person can't buy for as well. */
export function updateParticipant(
  id: number,
  { name, email }: { name: string; email: string },
  cantGiveTo?: number[],
) {
  transaction(() => {
    run("UPDATE participants SET name = ?, email = ? WHERE id = ?", name, email, id);
    if (cantGiveTo) {
      run("DELETE FROM restrictions WHERE giver_id = ?", id);
      for (const receiverId of cantGiveTo) {
        run("INSERT INTO restrictions (giver_id, receiver_id) VALUES (?, ?)", id, receiverId);
      }
    }
  });
}

export function deleteParticipant(id: number) {
  run("DELETE FROM participants WHERE id = ?", id);
}

/** Everyone's restrictions, each giver's sorted by the receiver's name. */
export function listRestrictions(): Restriction[] {
  return all<Restriction>(
    `SELECT r.giver_id AS giverId, r.receiver_id AS receiverId
     FROM restrictions r JOIN participants p ON p.id = r.receiver_id
     ORDER BY r.giver_id, p.name COLLATE NOCASE`,
  );
}

type RestrictionsResult =
  | { ok: true; value: number[] }
  | { ok: false; errors: Pick<ParticipantErrors, "cantGiveTo"> };

/** Reads who `giverId` can't buy for from the form's "cantGiveTo" fields. Blank fields mean nobody. */
export function parseRestrictionsForm(form: FormData, giverId: number): RestrictionsResult {
  const picked = form
    .getAll("cantGiveTo")
    .map(String)
    .filter(Boolean)
    .map(Number)
    // Nobody can draw themselves anyway.
    .filter((id) => id !== giverId);
  const ids = [...new Set(picked)];

  if (ids.length > MAX_RESTRICTIONS) {
    return { ok: false, errors: { cantGiveTo: `Pick up to ${MAX_RESTRICTIONS} people.` } };
  }
  const everyone = new Set(listParticipants().map((p) => p.id));
  if (!ids.every((id) => everyone.has(id))) {
    return {
      ok: false,
      errors: { cantGiveTo: "Someone you picked has been removed. Pick again." },
    };
  }
  return { ok: true, value: ids };
}
