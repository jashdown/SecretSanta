# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Patton Secret Santa: an organizer manages participants, draws names, and emails each person their assignment. Every emailed draw is kept as history. See README.md for user-facing behavior and all environment variables.

## Commands

Requires Node 22.13+ (uses the built-in `node:sqlite` and `process.loadEnvFile`).

```bash
npm run dev                  # http://localhost:5173, password "admin" unless ADMIN_PASSWORD is set
npm run typecheck            # react-router typegen && tsc
npm test                     # vitest run (all tests)
npm run test:watch
npx vitest run app/lib/assign.server.test.ts   # one file
npx vitest run -t "puts all"                   # tests whose name matches
npm run build && npm start   # production server on port 3000
npm run db:seed              # sample data into an empty DB; `-- --reset` wipes first
```

There is no linter or formatter configured. Run `npm run typecheck` after adding or renaming routes, since route types (`./+types/<route>`) are generated into `.react-router/`.

## Architecture

React Router v8 in framework mode with SSR, Tailwind v4, SQLite via `node:sqlite`, Nodemailer. A React Router skill with mode-specific references lives in `.agents/skills/react-router/`.

- **Routes are declared in `app/routes.ts`**, not by file name. Route modules export `loader`/`action`/`meta`/default component and import their types from `./+types/<name>`. `~/` is an alias for `app/`.
- **All server logic lives in `app/lib/*.server.ts`**; routes are thin and call into it. Each action dispatches on a hidden `intent` form field and returns either `{ ok, message }` or `data({ ok: false, errors }, { status: 400 })`.
- **Auth:** one shared admin password, cookie session (`session.server.ts`). The session stores an HMAC of the password (keyed with `SESSION_SECRET`), so changing `ADMIN_PASSWORD` signs everyone out. Wrong passwords are capped at 10 per 15 minutes for everyone at once (in memory; the app can't see client IPs). `routes/admin/layout.tsx` exports `middleware = [requireAdmin]`, which guards every loader/action under `/admin`. Its empty `loader` is deliberate: without it, client-side navigations skip the server and the middleware wouldn't run.
- **Database (`db.server.ts`):** synchronous `DatabaseSync` with `all`/`get`/`run`/`transaction` helpers (prepared statements are cached per SQL string, and `busy_timeout` is 5s); SQL aliases columns to camelCase (`giver_id AS giverId`). The connection is cached on `globalThis.__secretSantaDb` to survive HMR. Migrations are an append-only array tracked by `PRAGMA user_version`: add a new entry, never edit an old one.
- **History survives deletes:** `assignments` copies giver/receiver names and emails at draw time, and FKs are `ON DELETE SET NULL`. Queries `COALESCE` live participant data with the copies, so `giverId === null` means the person was removed. IDs use `AUTOINCREMENT` so a stale form can never hit a reused id.
- **Draw lifecycle (`draws.server.ts`):** `createDraw` replaces the latest draw unless it's kept (`isKept`): at least one assignment has `email_status = 'sent'`, or the draw is from an earlier calendar year. `'logged'` (console preview when `SMTP_HOST` is unset) does not count as sent. `checkDraw` flags a draw as stale when participants were added/removed or a newer restriction is broken.
- **Sending (`draws.server.ts`):** `sendDrawEmails` and `resendAssignmentEmail` take a draw id and do their own checks (still the latest draw, not stale), throwing `SendError` when they refuse. Sends run one batch at a time through an in-memory queue (`oneSendAtATime`), and `createDraw` throws while any are in flight. This relies on the app running as a single server process.
- **Drawing algorithm (`assign.server.ts`):** everyone goes into one cycle (no self-gifting, no mutual pairs). Restrictions (`blocked`) are hard constraints; the previous draw's pairs (`avoid`) are only a preference. It tries random shuffles first, then a bounded backtracking search: first for a loop with no repeats, then for any allowed loop with the fewest. Pairs are sorted by giver id before storing so row order doesn't reveal the loop. `DrawError` and `SendError` messages are shown to the organizer as-is.
- **Secrecy:** the organizer may also be a participant. Pairings stay hidden in the UI until revealed, and status messages avoid naming who is affected (e.g. `checkDraw` only counts broken restrictions). Keep that in mind when adding UI or messages.
- **Config (`env.server.ts`):** loads `.env` and reads everything once at import time. Production throws without `ADMIN_PASSWORD` and `SESSION_SECRET`; dev falls back to defaults. `MAIL_FROM` is required whenever `SMTP_HOST` is set, and SMTP requires STARTTLS unless it's implicit TLS or a loopback host.
- **Behind a proxy:** `allowedActionOrigins` in `react-router.config.ts` must list the public host (baked in at build time). Otherwise React Router's origin check rejects every action with 400, because the server sees `http://` while browsers send an `https://` Origin. Server setup (systemd, Apache, Cloudflare) is in `deploy/`.
- **Styling:** shared classes (`.btn`, `.btn-primary`, `.card`, `.input`, …) are defined in `app/app.css` under `@layer components`; shared components (`PageHeader`, `Notice`, `EmailStatusBadge`, `LocalTime`) are in `app/components/ui.tsx`.
- **Seed script (`scripts/seed.ts`)** loads `db.server.ts` through Vite's `runnerImport` so path aliases resolve and migrations run.

## Testing

- Tests sit next to the code (`foo.server.ts` → `foo.server.test.ts`). `vitest.config.ts` is separate from `vite.config.ts` because the React Router plugin shouldn't run under Vitest.
- `test/setup.ts` gives each test file its own temp SQLite DB via `DATABASE_PATH`. `vitest.config.ts` pins all env vars (empty = unset) so `.env` never affects tests. `mockReset`, `restoreMocks` and `unstubEnvs` are on.
- The default environment is node; component/page tests start with `// @vitest-environment jsdom`.
- Route tests call the real `loader`/`action` against the test DB using `test/helpers.ts` (`resetDb`, `addPeople`, `restrict`, `postRequest`, `routeArgs`, `expectRedirect`, `cookieFrom`). UI tests render routes with `createRoutesStub` plus the `HydrateFallback` helper.
- Email is mocked per file with `vi.mock("~/lib/email.server", ...)` (see `assignments.test.tsx`).
- Because `env.server.ts` evaluates at import, env tests use `vi.stubEnv` + `vi.resetModules()` and re-import (see `env.server.test.ts`).
