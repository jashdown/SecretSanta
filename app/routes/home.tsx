import { Link } from "react-router";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Patton Secret Santa" },
    { name: "description", content: "Our Patton Secret Santa gift exchange." },
  ];
}

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="text-5xl" aria-hidden>
          🎅
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Patton Secret Santa</h1>
        <p className="mt-3 text-stone-600 dark:text-stone-400">
          Your assignment arrives by email. Check your inbox to find out who you're buying
          for, and keep it a secret!
        </p>
        <Link to="/admin" className="btn btn-outline mt-6">
          Organizer sign in
        </Link>
      </div>
    </main>
  );
}
