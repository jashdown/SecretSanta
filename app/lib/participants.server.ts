import { all, get, run } from "./db.server";

export type Participant = { id: number; name: string; email: string };

export type ParticipantErrors = { name?: string; email?: string };

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

export function updateParticipant(
  id: number,
  { name, email }: { name: string; email: string },
) {
  run("UPDATE participants SET name = ?, email = ? WHERE id = ?", name, email, id);
}

export function deleteParticipant(id: number) {
  run("DELETE FROM participants WHERE id = ?", id);
}
