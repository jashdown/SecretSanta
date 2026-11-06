import { expect } from "vitest";
import { RouterContextProvider } from "react-router";
import { run } from "~/lib/db.server";
import {
  createParticipant,
  listParticipants,
  updateParticipant,
  type Participant,
} from "~/lib/participants.server";

/** Empties every table. */
export function resetDb() {
  run("DELETE FROM restrictions");
  run("DELETE FROM assignments");
  run("DELETE FROM draws");
  run("DELETE FROM participants");
}

/** Dates a draw to last year, as if it had been made then. */
export function moveToLastYear(drawId: number) {
  const lastYear = new Date().getFullYear() - 1;
  run("UPDATE draws SET created_at = ? WHERE id = ?", `${lastYear}-12-01T12:00:00.000Z`, drawId);
}

/** Adds people with emails like alice@example.com and returns everyone. */
export function addPeople(...names: string[]) {
  for (const name of names) {
    createParticipant({ name, email: `${name.toLowerCase()}@example.com` });
  }
  return listParticipants();
}

/** Sets who `giver` can't buy for, replacing any earlier restrictions. */
export function restrict(giver: Participant, ...receivers: Participant[]) {
  updateParticipant(giver.id, giver, receivers.map((r) => r.id));
}

export function formData(fields: Record<string, string | number>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  return form;
}

/** A form POST, as the browser would send it. */
export function postRequest(
  fields: Record<string, string | number>,
  { url = "http://localhost/", cookie }: { url?: string; cookie?: string } = {},
) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
  return new Request(url, {
    method: "POST",
    body,
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

/** The arguments React Router passes to a loader or action. */
export function routeArgs(request: Request = new Request("http://localhost/")) {
  return {
    request,
    url: new URL(request.url),
    pattern: new URL(request.url).pathname,
    params: {},
    context: new RouterContextProvider(),
  };
}

/**
 * For createRoutesStub: shown while a page's loader first runs. Without it,
 * React Router logs a warning.
 */
export const HydrateFallback = () => null;

/** Turns a Set-Cookie header into the value a browser would send back. */
export function cookieFrom(response: Response) {
  const header = response.headers.get("Set-Cookie");
  expect(header).toBeTruthy();
  return header!.split(";")[0];
}

export function expectRedirect(value: unknown, location: string) {
  expect(value).toBeInstanceOf(Response);
  const response = value as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(location);
  return response;
}
