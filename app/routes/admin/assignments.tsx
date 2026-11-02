import { useState } from "react";
import { data, Form, Link, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/assignments";
import { EmailStatusBadge, LocalTime, Notice, PageHeader } from "~/components/ui";
import { MIN_PARTICIPANTS } from "~/lib/assign.server";
import {
  checkDraw,
  createDraw,
  getLatestDraw,
  resendAssignmentEmail,
  sendDrawEmails,
  type Assignment,
  type Draw,
} from "~/lib/draws.server";
import { emailConfigured } from "~/lib/email.server";
import { listParticipants } from "~/lib/participants.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Assignments · Secret Santa" }];
}

const defaultDrawName = () => `Secret Santa ${new Date().getFullYear()}`;

export async function loader() {
  const participants = listParticipants();
  const draw = getLatestDraw();
  return {
    participantCount: participants.length,
    minParticipants: MIN_PARTICIPANTS,
    draw,
    status: draw ? checkDraw(draw, participants) : null,
    emailConfigured,
    defaultName: defaultDrawName(),
  };
}

type Result = { ok: boolean; message: string };
const fail = (message: string): Result => ({ ok: false, message });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function action({ request }: Route.ActionArgs): Promise<Result> {
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "draw") {
    if (listParticipants().length < MIN_PARTICIPANTS) {
      return fail(`Add at least ${MIN_PARTICIPANTS} participants first.`);
    }
    const name = String(form.get("name") ?? "").trim() || defaultDrawName();
    if (name.length > 100) return fail("Keep the name under 100 characters.");

    const { count, replaced, repeats } = createDraw(name);
    let message = `${replaced ? "Redrew" : "Made"} assignments for ${count} people.`;
    if (repeats > 0) {
      message += ` ${plural(repeats, "pairing")} from last time couldn't be avoided.`;
    }
    return { ok: true, message };
  }

  // Sending always targets the latest draw. Guard against a stale page
  // (e.g. someone redrew in another tab) emailing the wrong assignments.
  const draw = getLatestDraw();
  if (!draw || draw.id !== Number(form.get("drawId"))) {
    return fail("The assignments changed since this page loaded. Check them and try again.");
  }

  if (intent === "send") {
    if (!checkDraw(draw, listParticipants()).upToDate) {
      return fail("The participant list changed since this draw. Make new assignments first.");
    }
    const mode = form.get("mode") === "all" ? "all" : "unsent";
    const { sent, logged, failed } = await sendDrawEmails(draw, mode);
    if (sent + logged + failed === 0) return { ok: true, message: "Everyone has already been emailed." };
    if (logged > 0) {
      return {
        ok: true,
        message: `Printed ${plural(logged, "email")} to the server console. Nothing was sent because SMTP isn't set up.`,
      };
    }
    if (failed > 0) {
      const failures = `${plural(failed, "email")} failed. See the list below.`;
      return fail(sent > 0 ? `Emailed ${plural(sent, "person", "people")}, but ${failures}` : failures);
    }
    return { ok: true, message: `Emailed ${plural(sent, "person", "people")}. 🎉` };
  }

  if (intent === "resend") {
    const assignment = draw.assignments.find((a) => a.id === Number(form.get("assignmentId")));
    if (!assignment || assignment.giverId === null || assignment.receiverId === null) {
      return fail("That person is no longer taking part. Make new assignments first.");
    }
    const status = await resendAssignmentEmail(draw, assignment.id);
    return status === "failed"
      ? fail(`Couldn't email ${assignment.giverName}.`)
      : { ok: true, message: `Emailed ${assignment.giverName}.` };
  }

  throw data("Unknown action", { status: 400 });
}

export default function Assignments({ loaderData, actionData }: Route.ComponentProps) {
  const { draw, status, participantCount, minParticipants, defaultName } = loaderData;
  const navigation = useNavigation();
  const pendingIntent =
    navigation.state === "submitting" ? navigation.formData?.get("intent") : undefined;

  const enoughPeople = participantCount >= minParticipants;
  const willReplace = draw !== null && status !== null && !status.locked;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assignments"
        description="Draw names, then email everyone who they're buying for."
      />

      {!loaderData.emailConfigured && (
        <Notice tone="warning">
          <strong>Email isn't set up yet.</strong> Sending will print each email to the server
          console instead. Add your SMTP settings to <code className="font-mono">.env</code> to
          send real emails.
        </Notice>
      )}

      {actionData && navigation.state === "idle" && (
        <Notice tone={actionData.ok ? "success" : "error"}>{actionData.message}</Notice>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">Make assignments</h2>
        {enoughPeople ? (
          <Form
            method="post"
            className="mt-3"
            onSubmit={(event) => {
              if (willReplace && !confirm("Replace the current assignments with a new draw?")) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="draw" />
            <label htmlFor="draw-name" className="label">
              Name
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="draw-name"
                name="name"
                className="input sm:max-w-xs"
                defaultValue={willReplace ? draw.name : defaultName}
                key={`${draw?.id}-${willReplace}`}
                maxLength={100}
              />
              <button className="btn btn-primary" disabled={pendingIntent === "draw"}>
                {pendingIntent === "draw"
                  ? "Drawing…"
                  : willReplace
                    ? "Redraw"
                    : `Make assignments for ${participantCount}`}
              </button>
            </div>
            <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
              {willReplace
                ? "Nobody has been emailed yet, so a redraw replaces the current assignments."
                : draw
                  ? "This starts a new draw. The current one stays in History, and its pairings are avoided where possible."
                  : "Everyone goes into one random loop, so nobody gets themselves and no two people get each other."}
            </p>
          </Form>
        ) : (
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            You need at least {minParticipants} participants to draw names (you have{" "}
            {participantCount}).{" "}
            <Link to="/admin" className="font-medium text-red-700 underline dark:text-red-400">
              Add people
            </Link>
          </p>
        )}
      </section>

      {draw && status && <CurrentDraw key={draw.id} draw={draw} status={status} />}
    </div>
  );
}

function CurrentDraw({
  draw,
  status,
}: {
  draw: Draw;
  status: NonNullable<Route.ComponentProps["loaderData"]["status"]>;
}) {
  const [revealed, setRevealed] = useState(false);
  const navigation = useNavigation();
  const sending = navigation.state === "submitting" && navigation.formData?.get("intent") === "send";

  const total = draw.assignments.length;
  const mode = status.unsent > 0 ? "unsent" : "all";
  const sendLabel =
    status.sent === 0
      ? `Email all ${total}`
      : status.unsent > 0
        ? `Email the ${status.unsent} not yet sent`
        : "Resend to everyone";

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
        <div>
          <h2 className="font-semibold">{draw.name}</h2>
          <p className="text-sm text-stone-500">
            Drawn <LocalTime iso={draw.createdAt} /> · {status.sent} of {total} emailed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline" onClick={() => setRevealed(!revealed)}>
            {revealed ? "Hide pairings" : "Show pairings"}
          </button>
          <Form
            method="post"
            onSubmit={(event) => {
              const ok =
                mode === "unsent" ||
                confirm("Everyone has already been emailed. Send everyone their assignment again?");
              if (!ok) event.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="send" />
            <input type="hidden" name="drawId" value={draw.id} />
            <input type="hidden" name="mode" value={mode} />
            <button className="btn btn-green" disabled={sending || !status.upToDate}>
              {sending ? "Sending…" : sendLabel}
            </button>
          </Form>
        </div>
      </div>

      {!status.upToDate && (
        <div className="border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <Notice tone="warning">
            The participant list changed since this draw
            {status.added.length > 0 && <> (added {status.added.join(", ")})</>}
            {status.removed.length > 0 && <> (removed {status.removed.join(", ")})</>}. Make new
            assignments before emailing everyone.
          </Notice>
        </div>
      )}

      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {draw.assignments.map((assignment) => (
          <AssignmentRow
            key={assignment.id}
            assignment={assignment}
            drawId={draw.id}
            revealed={revealed}
          />
        ))}
      </ul>
      {!revealed && (
        <p className="border-t border-stone-200 px-5 py-3 text-xs text-stone-500 dark:border-stone-800">
          Pairings are hidden so you don't spoil your own surprise.
        </p>
      )}
    </section>
  );
}

function AssignmentRow({
  assignment: a,
  drawId,
  revealed,
}: {
  assignment: Assignment;
  drawId: number;
  revealed: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const removed = a.giverId === null || a.receiverId === null;

  return (
    <li className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{a.giverName}</p>
        <p className="truncate text-sm text-stone-500">{a.giverEmail}</p>
      </div>
      <p className="min-w-0 truncate text-sm">
        <span className="text-stone-500">gives to </span>
        {revealed ? (
          <span className="font-medium">{a.receiverName}</span>
        ) : (
          <>
            <span className="tracking-widest text-stone-400" aria-hidden>
              •••••
            </span>
            <span className="sr-only">hidden</span>
          </>
        )}
      </p>
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <EmailStatusBadge status={a.emailStatus} />
          {a.emailedAt && (
            <span className="text-xs text-stone-500">
              <LocalTime iso={a.emailedAt} />
            </span>
          )}
        </div>
        {a.emailStatus === "failed" && a.emailError && (
          <p className="mt-1 text-xs break-words text-red-700 dark:text-red-400">{a.emailError}</p>
        )}
      </div>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="resend" />
        <input type="hidden" name="drawId" value={drawId} />
        <input type="hidden" name="assignmentId" value={a.id} />
        <button className="btn btn-outline btn-sm" disabled={busy || removed}>
          {busy ? "Sending…" : a.emailStatus === "pending" ? "Send" : "Resend"}
        </button>
      </fetcher.Form>
    </li>
  );
}
