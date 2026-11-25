import { all, get, run, transaction } from "./db.server";

export type Participant = {
  id: number;
  name: string;
  email: string;
  /** Links to their wish lists, in the order they were entered. */
  wishlist: string[];
};

type ParticipantInput = Omit<Participant, "id">;

/** The giver must never be given the receiver to buy for. */
export type Restriction = { giverId: number; receiverId: number };

export type ParticipantErrors = {
  name?: string;
  email?: string;
  wishlist?: string;
  cantGiveTo?: string;
};

type ParseResult =
  | { ok: true; value: ParticipantInput }
  | { ok: false; errors: ParticipantErrors };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_WISHLIST_LINKS = 10;
const MAX_LINK_LENGTH = 2000;

export function listParticipants(): Participant[] {
  return all<Omit<Participant, "wishlist"> & { wishlist: string }>(
    "SELECT id, name, email, wishlist FROM participants ORDER BY name COLLATE NOCASE",
  ).map((p) => ({ ...p, wishlist: JSON.parse(p.wishlist) }));
}

/**
 * Validates name, email and wish list from a form. Pass `id` when editing so
 * the person doesn't clash with themselves.
 */
export function parseParticipantForm(form: FormData, id?: number): ParseResult {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const wishlist = parseWishlist(String(form.get("wishlist") ?? ""));
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

  if (wishlist.error) errors.wishlist = wishlist.error;

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { name, email, wishlist: wishlist.links } };
}

/**
 * Reads wish list links, one per line. Blank lines and repeats are dropped,
 * and "https://" is added when it's left off.
 */
function parseWishlist(text: string): { links: string[]; error?: string } {
  const links: string[] = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const link = toLink(line.trim());
    if (!link) return { links: [], error: `Line ${i + 1} doesn't look like a web link.` };
    if (!links.includes(link)) links.push(link);
  }
  if (links.length > MAX_WISHLIST_LINKS) {
    return { links: [], error: `Keep it to ${MAX_WISHLIST_LINKS} links or fewer.` };
  }
  return { links };
}

function toLink(text: string): string | null {
  if (text.length > MAX_LINK_LENGTH) return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  // Only plain web pages, since these become clickable links in emails. The
  // dot rules out a stray word like "Amazon" turning into https://amazon/, and
  // a user:password@ part is a classic way to disguise where a link goes.
  const web = url.protocol === "https:" || url.protocol === "http:";
  const disguised = url.username !== "" || url.password !== "";
  return web && !disguised && url.hostname.includes(".") ? url.href : null;
}

/** New people start with no wish list unless one is given. */
export function createParticipant({
  name,
  email,
  wishlist = [],
}: Omit<ParticipantInput, "wishlist"> & { wishlist?: string[] }) {
  run(
    "INSERT INTO participants (name, email, wishlist) VALUES (?, ?, ?)",
    name,
    email,
    JSON.stringify(wishlist),
  );
}

/** Pass `cantGiveTo` to replace who this person can't buy for as well. */
export function updateParticipant(
  id: number,
  { name, email, wishlist }: ParticipantInput,
  cantGiveTo?: number[],
) {
  transaction(() => {
    const { changes } = run(
      "UPDATE participants SET name = ?, email = ?, wishlist = ? WHERE id = ?",
      name,
      email,
      JSON.stringify(wishlist),
      id,
    );
    // Nothing to attach restrictions to if they were removed in the meantime.
    if (changes && cantGiveTo) {
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

/** Reads who `giverId` can't buy for from the form's "cantGiveTo" fields. Blank values are ignored. */
export function parseRestrictionsForm(form: FormData, giverId: number): RestrictionsResult {
  const picked = form
    .getAll("cantGiveTo")
    .map(String)
    .filter(Boolean)
    .map(Number)
    // Nobody can draw themselves anyway.
    .filter((id) => id !== giverId);
  const ids = [...new Set(picked)];

  const others = new Set(listParticipants().map((p) => p.id).filter((id) => id !== giverId));
  if (!ids.every((id) => others.has(id))) {
    return {
      ok: false,
      errors: { cantGiveTo: "Someone you picked has been removed. Pick again." },
    };
  }
  if (ids.length > 0 && ids.length === others.size) {
    return { ok: false, errors: { cantGiveTo: "Leave at least one person they can give to." } };
  }
  return { ok: true, value: ids };
}
