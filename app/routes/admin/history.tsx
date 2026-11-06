import { Link } from "react-router";
import type { Route } from "./+types/history";
import { LocalTime, PageHeader } from "~/components/ui";
import { listDraws } from "~/lib/draws.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "History · Patton Secret Santa" }];
}

export async function loader() {
  const draws = listDraws();

  // One row per person (matched by email), one column per draw.
  const people = new Map<string, { name: string; receivers: Record<number, string> }>();
  for (const draw of draws) {
    for (const a of draw.assignments) {
      const key = a.giverEmail.toLowerCase();
      // Draws are newest first, so the first name seen is the most recent.
      const person = people.get(key) ?? { name: a.giverName, receivers: {} };
      person.receivers[draw.id] = a.receiverName;
      people.set(key, person);
    }
  }

  return {
    draws,
    people: [...people.entries()]
      .map(([key, person]) => ({ key, ...person }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { draws, people } = loaderData;

  if (draws.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="History" />
        <div className="card px-5 py-10 text-center text-stone-500">
          No draws yet.{" "}
          <Link to="/admin/assignments" className="font-medium text-red-700 underline dark:text-red-400">
            Make the first assignments
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="History"
        description="Every draw so far. Pairings stay hidden until you open a section."
      />

      <details className="card group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden font-semibold">
          Who each person has given to
          <Chevron />
        </summary>
        <div className="overflow-x-auto border-t border-stone-200 dark:border-stone-800">
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th scope="col" className="sticky left-0 bg-white px-5 py-2 font-medium dark:bg-stone-900">
                  Person
                </th>
                {draws.map((draw) => (
                  <th key={draw.id} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                    {draw.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
              {people.map((person) => (
                <tr key={person.key}>
                  <th
                    scope="row"
                    className="sticky left-0 bg-white px-5 py-2 font-medium whitespace-nowrap dark:bg-stone-900"
                  >
                    {person.name}
                  </th>
                  {draws.map((draw) => (
                    <td key={draw.id} className="px-4 py-2 whitespace-nowrap">
                      {person.receivers[draw.id] ?? <span className="text-stone-400">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="space-y-3">
        {draws.map((draw, index) => {
          const sent = draw.assignments.filter((a) => a.emailStatus === "sent").length;
          return (
            <details key={draw.id} className="card group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    {draw.name}
                    {index === 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
                        Current
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-stone-500">
                    <LocalTime iso={draw.createdAt} dateOnly /> · {draw.assignments.length} people ·{" "}
                    {sent === 0 ? "not emailed" : `${sent} emailed`}
                  </p>
                </div>
                <Chevron />
              </summary>
              <ul className="divide-y divide-stone-200 border-t border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                {draw.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-2 px-5 py-2.5 text-sm">
                    <span className="font-medium">{a.giverName}</span>
                    <span className="text-stone-400" aria-hidden>
                      →
                    </span>
                    <span className="sr-only">gives to</span>
                    <span>{a.receiverName}</span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="currentColor"
      className="size-5 shrink-0 text-stone-400 transition-transform group-open:rotate-180"
    >
      <path
        fillRule="evenodd"
        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
