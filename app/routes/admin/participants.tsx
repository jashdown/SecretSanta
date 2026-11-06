import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { data, useFetcher } from "react-router";
import type { Route } from "./+types/participants";
import { PageHeader } from "~/components/ui";
import {
  createParticipant,
  deleteParticipant,
  listParticipants,
  listRestrictions,
  parseParticipantForm,
  parseRestrictionsForm,
  updateParticipant,
  type Participant,
  type ParticipantErrors,
} from "~/lib/participants.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Participants · Patton Secret Santa" }];
}

type Person = Participant & {
  /** Ids of the people this person can't buy for. */
  cantGiveTo: number[];
};

export async function loader() {
  const restrictions = listRestrictions();
  const participants: Person[] = listParticipants().map((p) => ({
    ...p,
    cantGiveTo: restrictions.filter((r) => r.giverId === p.id).map((r) => r.receiverId),
  }));
  return { participants };
}

const invalid = (errors: ParticipantErrors) =>
  data({ ok: false as const, errors }, { status: 400 });

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  const id = Number(form.get("id"));

  if (intent === "delete") {
    deleteParticipant(id);
    return { ok: true as const };
  }

  if (intent === "create") {
    const result = parseParticipantForm(form);
    if (!result.ok) return invalid(result.errors);
    createParticipant(result.value);
    return { ok: true as const };
  }

  if (intent === "update") {
    const result = parseParticipantForm(form, id);
    const restrictions = parseRestrictionsForm(form, id);
    if (!result.ok || !restrictions.ok) {
      return invalid({
        ...(!result.ok && result.errors),
        ...(!restrictions.ok && restrictions.errors),
      });
    }
    updateParticipant(id, result.value, restrictions.value);
    return { ok: true as const };
  }

  throw data("Unknown action", { status: 400 });
}

export default function Participants({ loaderData }: Route.ComponentProps) {
  const { participants } = loaderData;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Participants"
        description="Everyone taking part in the gift exchange. Use Edit to choose who someone can't give to."
      />
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
              <ParticipantRow
                key={participant.id}
                participant={participant}
                everyone={participants}
              />
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

type RowProps = { participant: Person; everyone: Person[] };

// "Bob, Carol, or Dave". A fixed locale so the server and browser agree.
const orList = new Intl.ListFormat("en", { type: "disjunction" });

function ParticipantRow({ participant, everyone }: RowProps) {
  const [editing, setEditing] = useState(false);
  const fetcher = useFetcher<typeof action>();

  // Hide the row straight away while the delete is in flight.
  if (fetcher.formData?.get("intent") === "delete") return null;

  if (editing) {
    return (
      <li className="px-5 py-3">
        <EditParticipant
          participant={participant}
          everyone={everyone}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const cantGiveTo = participant.cantGiveTo
    .map((id) => everyone.find((p) => p.id === id)?.name)
    .filter((name) => name !== undefined);

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Initial name={participant.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{participant.name}</p>
        <p className="truncate text-sm text-stone-500">{participant.email}</p>
        {cantGiveTo.length > 0 && (
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
            Can't give to {orList.format(cantGiveTo)}
          </p>
        )}
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

function EditParticipant({
  participant,
  everyone,
  onDone,
}: RowProps & { onDone: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : undefined;
  const busy = fetcher.state !== "idle";
  const others = everyone.filter((p) => p.id !== participant.id);

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
      {others.length > 0 && (
        <RestrictionPicker
          others={others}
          selected={participant.cantGiveTo}
          error={errors?.cantGiveTo}
        />
      )}
      <div className="flex gap-2 sm:col-start-3 sm:row-start-1">
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

function RestrictionPicker({
  others,
  selected,
  error,
}: {
  others: Participant[];
  selected: number[];
  error?: string;
}) {
  const id = useId();
  return (
    <fieldset
      className="sm:col-span-2 sm:row-start-2"
      aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
    >
      <legend className="label">Can't give to</legend>
      <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto sm:grid-cols-3">
        {others.map((p) => (
          <label key={p.id} className="flex min-w-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="cantGiveTo"
              value={p.id}
              defaultChecked={selected.includes(p.id)}
              className="size-4 shrink-0 accent-red-700"
            />
            <span className="truncate">{p.name}</span>
          </label>
        ))}
      </div>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-stone-500">
        This only works one way. For a couple, set it for both of them.
      </p>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </fieldset>
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
