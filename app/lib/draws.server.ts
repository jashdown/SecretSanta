import { drawPairs, pairKey } from "./assign.server";
import { all, get, run, transaction } from "./db.server";
import { sendAssignmentEmail } from "./email.server";
import { listParticipants, type Participant } from "./participants.server";

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

/** All draws, newest first. */
export function listDraws(): Draw[] {
  return attachAssignments(all<DrawRow>(`${DRAWS_SELECT} ORDER BY id DESC`));
}

export function getLatestDraw(): Draw | null {
  return attachAssignments(all<DrawRow>(`${DRAWS_SELECT} ORDER BY id DESC LIMIT 1`))[0] ?? null;
}

/**
 * Makes new assignments for every current participant. If nobody has been
 * emailed about the latest draw yet, that draw is replaced instead of being
 * kept in history. Pairings from the previous draw are avoided when possible.
 */
export function createDraw(name: string) {
  return transaction(() => {
    const participants = listParticipants();

    const latest = get<{ id: number; sent: number }>(
      `SELECT d.id,
         (SELECT COUNT(*) FROM assignments WHERE draw_id = d.id AND email_status = 'sent') AS sent
       FROM draws d ORDER BY d.id DESC LIMIT 1`,
    );
    const replaced = latest !== undefined && latest.sent === 0;
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

    const pairs = drawPairs(
      participants.map((p) => p.id),
      avoid,
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

/** Whether the draw still matches the participant list, and what has changed. */
export function checkDraw(draw: Draw, participants: Participant[]) {
  const inDraw = new Set(draw.assignments.map((a) => a.giverId));
  const added = participants.filter((p) => !inDraw.has(p.id)).map((p) => p.name);
  const removed = draw.assignments.filter((a) => a.giverId === null).map((a) => a.giverName);
  const sent = draw.assignments.filter((a) => a.emailStatus === "sent").length;
  return {
    added,
    removed,
    upToDate: added.length === 0 && removed.length === 0,
    sent,
    unsent: draw.assignments.length - sent,
    /** Kept in history once anyone has really been emailed. */
    locked: sent > 0,
  };
}

/** Emails each giver in the draw. "unsent" skips anyone already emailed successfully. */
export async function sendDrawEmails(draw: Draw, mode: "unsent" | "all") {
  const targets = draw.assignments.filter((a) => mode === "all" || a.emailStatus !== "sent");
  const results = { sent: 0, logged: 0, failed: 0 };
  // One at a time keeps us well under SMTP providers' rate limits.
  for (const assignment of targets) {
    results[await deliver(draw.name, assignment)]++;
  }
  return results;
}

export async function resendAssignmentEmail(draw: Draw, assignmentId: number) {
  const assignment = draw.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return null;
  return deliver(draw.name, assignment);
}

async function deliver(drawName: string, a: Assignment): Promise<"sent" | "logged" | "failed"> {
  const attemptedAt = new Date().toISOString();
  try {
    const status = await sendAssignmentEmail({
      to: a.giverEmail,
      giverName: a.giverName,
      receiverName: a.receiverName,
      drawName,
    });
    run(
      "UPDATE assignments SET email_status = ?, email_error = NULL, emailed_at = ? WHERE id = ?",
      status,
      attemptedAt,
      a.id,
    );
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to email ${a.giverEmail}: ${message}`);
    run(
      "UPDATE assignments SET email_status = 'failed', email_error = ?, emailed_at = ? WHERE id = ?",
      message,
      attemptedAt,
      a.id,
    );
    return "failed";
  }
}
