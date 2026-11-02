import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { data, useFetcher } from "react-router";
import type { Route } from "./+types/participants";
import { PageHeader } from "~/components/ui";
import {
  createParticipant,
  deleteParticipant,
  listParticipants,
  parseParticipantForm,
  updateParticipant,
  type Participant,
} from "~/lib/participants.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Participants · Secret Santa" }];
}

export async function loader() {
  return { participants: listParticipants() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  const id = Number(form.get("id"));

  if (intent === "delete") {
    deleteParticipant(id);
    return { ok: true as const };
  }

  if (intent === "create" || intent === "update") {
    const result = parseParticipantForm(form, intent === "update" ? id : undefined);
    if (!result.ok) {
      return data({ ok: false as const, errors: result.errors }, { status: 400 });
    }
    if (intent === "create") createParticipant(result.value);
    else updateParticipant(id, result.value);
    return { ok: true as const };
  }

  throw data("Unknown action", { status: 400 });
}

export default function Participants({ loaderData }: Route.ComponentProps) {
  const { participants } = loaderData;

  return (
    <div className="space-y-6">
      <PageHeader title="Participants" description="Everyone taking part in the gift exchange." />
      <AddParticipant />
      <section className="card">
        <h2 className="border-b border-stone-200 px-5 py-3 font-semibold dark:border-stone-800">
          {participants.length} {participants.length === 1 ? "person" : "people"}
        </h2>
        {participants.length === 0 ? (
          <p className="px-5 py-10 text-center text-stone-500">
            Nobody yet. Add the first person above.
          </p>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {participants.map((participant) => (
              <ParticipantRow key={participant.id} participant={participant} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddParticipant() {
  const fetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : undefined;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      formRef.current?.reset();
      nameRef.current?.focus();
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form ref={formRef} method="post" className="card p-5">
      <h2 className="mb-3 font-semibold">Add someone</h2>
      <input type="hidden" name="intent" value="create" />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <Field ref={nameRef} label="Name" name="name" error={errors?.name} autoComplete="off" required />
        <Field label="Email" name="email" type="email" error={errors?.email} autoComplete="off" required />
        <button className="btn btn-primary sm:mt-6" disabled={busy}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </fetcher.Form>
  );
}

function ParticipantRow({ participant }: { participant: Participant }) {
  const [editing, setEditing] = useState(false);
  const fetcher = useFetcher<typeof action>();

  // Hide the row straight away while the delete is in flight.
  if (fetcher.formData?.get("intent") === "delete") return null;

  if (editing) {
    return (
      <li className="px-5 py-3">
        <EditParticipant participant={participant} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Initial name={participant.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{participant.name}</p>
        <p className="truncate text-sm text-stone-500">{participant.email}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
        Edit
      </button>
      <fetcher.Form
        method="post"
        onSubmit={(event) => {
          const ok = confirm(
            `Remove ${participant.name}? They'll still appear in the history of past draws.`,
          );
          if (!ok) event.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="id" value={participant.id} />
        <button className="btn btn-danger btn-sm">Remove</button>
      </fetcher.Form>
    </li>
  );
}

function EditParticipant({ participant, onDone }: { participant: Participant; onDone: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : undefined;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
  }, [fetcher.state, fetcher.data, onDone]);

  return (
    <fetcher.Form
      method="post"
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
      onKeyDown={(event) => event.key === "Escape" && onDone()}
    >
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="id" value={participant.id} />
      <Field
        label="Name"
        hideLabel
        name="name"
        defaultValue={participant.name}
        error={errors?.name}
        required
        autoFocus
      />
      <Field
        label="Email"
        hideLabel
        name="email"
        type="email"
        defaultValue={participant.email}
        error={errors?.email}
        required
      />
      <div className="flex gap-2">
        <button className="btn btn-green" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </fetcher.Form>
  );
}

function Field({
  label,
  hideLabel = false,
  error,
  ...props
}: { label: string; hideLabel?: boolean; error?: string } & ComponentProps<"input">) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "label"}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function Initial({ name }: { name: string }) {
  const colors = [
    "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ];
  const color = colors[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colors.length];
  return (
    <span
      aria-hidden
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${color}`}
    >
      {[...name][0]?.toUpperCase()}
    </span>
  );
}
