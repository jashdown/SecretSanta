import { DrawError, drawPairs, pairKey } from "./assign.server";
import { all, get, run, transaction } from "./db.server";
import { sendAssignmentEmail } from "./email.server";
import {
  listParticipants,
  listRestrictions,
  type Participant,
  type Restriction,
} from "./participants.server";

export type EmailStatus = "pending" | "sent" | "logged" | "failed";

export type Assignment = {
  id: number;
  drawId: number;
  /** null once the participant has been removed */
  giverId: number | null;
  giverName: string;
  giverEmail: string;
  receiverId: number | null;
  receiverName: string;
  emailStatus: EmailStatus;
  emailError: string | null;
  /** time of the last send attempt */
  emailedAt: string | null;
};

export type Draw = {
  id: number;
  name: string;
  createdAt: string;
  assignments: Assignment[];
};

type DrawRow = Omit<Draw, "assignments">;

/** Emails can't go out. The message is meant for the organizer. */
export class SendError extends Error {
  name = "SendError";
}

// Emails go out one batch at a time, so two clicks can't email someone twice,
// and while any are going out, createDraw won't replace the draw they belong
// to. The app runs as one server process, so tracking this in memory is enough.
let sendQueue: Promise<unknown> = Promise.resolve();
let sendsWaiting = 0;

function oneSendAtATime<T>(send: () => Promise<T>): Promise<T> {
  sendsWaiting++;
  const result = sendQueue.then(send).finally(() => {
    sendsWaiting--;
  });
  sendQueue = result.catch(() => {});
  return result;
}

// Show current names/emails, falling back to the copies saved at draw time
// for people who have since been removed.
const ASSIGNMENTS_SELECT = `
  SELECT
    a.id,
    a.draw_id AS drawId,
    a.giver_id AS giverId,
    COALESCE(g.name, a.giver_name) AS giverName,
    COALESCE(g.email, a.giver_email) AS giverEmail,
    a.receiver_id AS receiverId,
    COALESCE(r.name, a.receiver_name) AS receiverName,
    a.email_status AS emailStatus,
    a.email_error AS emailError,
    a.emailed_at AS emailedAt
  FROM assignments a
  LEFT JOIN participants g ON g.id = a.giver_id
  LEFT JOIN participants r ON r.id = a.receiver_id`;

const DRAWS_SELECT = "SELECT id, name, created_at AS createdAt FROM draws";

function attachAssignments(draws: DrawRow[]): Draw[] {
  if (draws.length === 0) return [];
  const ids = draws.map((d) => d.id);
  const assignments = all<Assignment>(
    `${ASSIGNMENTS_SELECT}
     WHERE a.draw_id IN (${ids.map(() => "?").join(", ")})
     ORDER BY giverName COLLATE NOCASE`,
    ...ids,
  );
  return draws.map((draw) => ({
    ...draw,
    assignments: assignments.filter((a) => a.drawId === draw.id),
  }));
}

/**
 * Whether a draw stays in history instead of being replaced by the next one:
 * once anyone has really been emailed, or once it's from an earlier year,
 * since it may have been handed out some other way (e.g. console previews).
 */
function isKept(createdAt: string, sent: number) {
  return sent > 0 || new Date(createdAt).getFullYear() < new Date().getFullYear();
}

/** All draws, newest first. */
export function listDraws(): Draw[] {
  return attachAssignments(all<DrawRow>(`${DRAWS_SELECT} ORDER BY id DESC`));
}

export function getLatestDraw(): Draw | null {
  return attachAssignments(all<DrawRow>(`${DRAWS_SELECT} ORDER BY id DESC LIMIT 1`))[0] ?? null;
}

/**
 * Makes new assignments for every current participant. If nobody has been
 * emailed about the latest draw yet and it's from this year, that draw is
 * replaced instead of being kept in history. Restrictions are always
 * followed, and pairings from the previous draw are avoided when possible. Throws DrawError if no draw fits,
 * or while emails are going out.
 */
export function createDraw(name: string) {
  // Otherwise emails could keep going out for pairings that were just replaced.
  if (sendsWaiting > 0) {
    throw new DrawError("Emails are still going out. Wait for them to finish, then try again.");
  }
  return transaction(() => {
    const participants = listParticipants();

    const latest = get<{ id: number; createdAt: string; sent: number }>(
      `SELECT d.id, d.created_at AS createdAt,
         (SELECT COUNT(*) FROM assignments WHERE draw_id = d.id AND email_status = 'sent') AS sent
       FROM draws d ORDER BY d.id DESC LIMIT 1`,
    );
    const replaced = latest !== undefined && !isKept(latest.createdAt, latest.sent);
    if (replaced) run("DELETE FROM draws WHERE id = ?", latest.id);

    const previous = get<{ id: number }>("SELECT id FROM draws ORDER BY id DESC LIMIT 1");
    const avoid = new Set(
      previous
        ? all<{ giverId: number; receiverId: number }>(
            `SELECT giver_id AS giverId, receiver_id AS receiverId FROM assignments
             WHERE draw_id = ? AND giver_id IS NOT NULL AND receiver_id IS NOT NULL`,
            previous.id,
          ).map((p) => pairKey(p.giverId, p.receiverId))
        : [],
    );

    const blocked = new Set(listRestrictions().map((r) => pairKey(r.giverId, r.receiverId)));

    const pairs = drawPairs(
      participants.map((p) => p.id),
      { blocked, avoid },
    );
    const byId = new Map(participants.map((p) => [p.id, p]));
    const drawId = Number(run("INSERT INTO draws (name) VALUES (?)", name).lastInsertRowid);
    for (const pair of pairs) {
      const giver = byId.get(pair.giverId)!;
      const receiver = byId.get(pair.receiverId)!;
      run(
        `INSERT INTO assignments
           (draw_id, giver_id, giver_name, giver_email, receiver_id, receiver_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        drawId,
        giver.id,
        giver.name,
        giver.email,
        receiver.id,
        receiver.name,
      );
    }

    const repeats = pairs.filter((p) => avoid.has(pairKey(p.giverId, p.receiverId))).length;
    return { replaced, count: pairs.length, repeats };
  });
}

/** Whether the draw still matches the participants and their restrictions, and what has changed. */
export function checkDraw(draw: Draw, participants: Participant[], restrictions: Restriction[]) {
  const inDraw = new Set(draw.assignments.map((a) => a.giverId));
  const added = participants.filter((p) => !inDraw.has(p.id)).map((p) => p.name);
  const removed = draw.assignments.filter((a) => a.giverId === null).map((a) => a.giverName);
  const blocked = new Set(restrictions.map((r) => pairKey(r.giverId, r.receiverId)));
  // Only a count: naming anyone would hint at who they drew.
  const restricted = draw.assignments.filter(
    (a) =>
      a.giverId !== null &&
      a.receiverId !== null &&
      blocked.has(pairKey(a.giverId, a.receiverId)),
  ).length;
  const sent = draw.assignments.filter((a) => a.emailStatus === "sent").length;
  return {
    added,
    removed,
    /** Assignments that break a restriction set after the draw. */
    restricted,
    upToDate: added.length === 0 && removed.length === 0 && restricted === 0,
    sent,
    unsent: draw.assignments.length - sent,
    /** Kept in history, so the next draw starts a new one instead of replacing it. */
    locked: isKept(draw.createdAt, sent),
  };
}

/** The latest draw, as long as it's still the one the organizer's page showed. */
function currentDraw(drawId: number): Draw {
  const draw = getLatestDraw();
  // A stale page (e.g. someone redrew in another tab) must not email the wrong assignments.
  if (!draw || draw.id !== drawId) {
    throw new SendError(
      "The assignments changed since this page loaded. Check them and try again.",
    );
  }
  return draw;
}

/** Refuses a draw that no longer matches the participants or their restrictions. */
function assertUpToDate(draw: Draw) {
  const status = checkDraw(draw, listParticipants(), listRestrictions());
  if (status.added.length > 0 || status.removed.length > 0) {
    throw new SendError(
      "The participant list changed since this draw. Make new assignments first.",
    );
  }
  if (status.restricted > 0) {
    throw new SendError("The restrictions changed since this draw. Make new assignments first.");
  }
}

/**
 * Emails each giver in the latest draw, which must be `drawId` and still up to
 * date. "unsent" skips anyone already emailed successfully. Throws SendError
 * if the draw can't be emailed.
 */
export function sendDrawEmails(drawId: number, mode: "unsent" | "all") {
  return oneSendAtATime(async () => {
    const draw = currentDraw(drawId);
    assertUpToDate(draw);
    const targets = draw.assignments.filter((a) => mode === "all" || a.emailStatus !== "sent");
    const results = { sent: 0, logged: 0, failed: 0 };
    // One at a time keeps us well under SMTP providers' rate limits.
    for (const assignment of targets) {
      results[await deliver(draw.name, assignment)]++;
    }
    return results;
  });
}

/** Emails one giver in the latest draw, under the same rules as sendDrawEmails. */
export function resendAssignmentEmail(drawId: number, assignmentId: number) {
  return oneSendAtATime(async () => {
    const draw = currentDraw(drawId);
    const assignment = draw.assignments.find((a) => a.id === assignmentId);
    if (!assignment || assignment.giverId === null || assignment.receiverId === null) {
      throw new SendError("That person is no longer taking part. Make new assignments first.");
    }
    assertUpToDate(draw);
    return { giverName: assignment.giverName, status: await deliver(draw.name, assignment) };
  });
}

async function deliver(drawName: string, a: Assignment): Promise<"sent" | "logged" | "failed"> {
  const attemptedAt = new Date().toISOString();
  let status: "sent" | "logged" | "failed";
  let errorMessage: string | null = null;
  try {
    status = await sendAssignmentEmail({
      to: a.giverEmail,
      giverName: a.giverName,
      receiverName: a.receiverName,
      drawName,
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to email ${a.giverEmail}: ${errorMessage}`);
    status = "failed";
  }
  // Outside the try, so a database error can't mark an email that went out as failed.
  run(
    "UPDATE assignments SET email_status = ?, email_error = ?, emailed_at = ? WHERE id = ?",
    status,
    errorMessage,
    attemptedAt,
    a.id,
  );
  return status;
}
