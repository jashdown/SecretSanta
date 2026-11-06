# Patton Secret Santa

A small app for running a Secret Santa gift exchange. An organizer manages the
list of people, draws names, and emails everyone who they're buying for. Every
draw is kept, so you can look back at who gave to whom in past years.

Built with React Router (framework mode), SQLite (built into Node) and
Nodemailer.

## What it does

- **Participants:** add, edit and remove people (name + email). When editing
  someone you can also tick the people they can't give to, for example their
  partner. Tick as many as you like, as long as there's someone left.
- **Assignments:** one button draws names, another emails each person their
  assignment. You can resend to one person, for example after fixing a typo in
  their email. Pairings stay hidden on screen until you click "Show pairings",
  so the organizer can take part too.
- **History:** every draw that was emailed, plus a table of who each person
  has given to over the years.

### How names are drawn

Everyone goes into one random loop (A → B → C → … → A), which means:

- nobody gets themselves
- no two people get each other
- restrictions are always followed
- pairings from the previous draw are avoided whenever possible

Restrictions only go one way: "Alice can't give to Bob" still lets Bob give to
Alice. For a couple, set it for both of them. If the restrictions leave no
possible draw (say a couple in a group of three), the app says so and keeps
the current assignments.

You need at least 3 people. Until someone has actually been emailed you can
redraw as often as you like, and each redraw replaces the last one. After
emails go out the draw is kept in history, and the next draw starts a new one.

If you add or remove people, or add a restriction the current draw breaks, the
app asks you to redraw before it will email anyone.

## Getting started

Requires Node 22.13 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173 and sign in. In development the password is `admin`
unless you set `ADMIN_PASSWORD`.

To fill an empty database with sample people, restrictions and two past draws:

```bash
npm run db:seed              # only if the database is empty
npm run db:seed -- --reset   # wipes everything first
```

Until SMTP is configured, "sending" prints each email to the terminal instead.
That's a safe way to try things out. Preview sends don't count as sent, so
redrawing afterwards still replaces the draw.

## Configuration

All settings are environment variables. In development you can put them in
`.env`. See [.env.example](.env.example) for the full list.

| Variable         | Required in production | Description                                                              |
| ---------------- | ---------------------- | ------------------------------------------------------------------------ |
| `ADMIN_PASSWORD` | yes                    | Password for the organizer pages.                                        |
| `SESSION_SECRET` | yes                    | Random string that signs the login cookie (`openssl rand -hex 32`).      |
| `DATABASE_PATH`  | no                     | SQLite file location. Default `data/secret-santa.db`.                    |
| `COOKIE_SECURE`  | no                     | Defaults to `true` in production. Set `false` if serving over plain http. |
| `SMTP_HOST`      | to send real email     | SMTP server. Leave empty to print emails to the console instead.        |
| `SMTP_PORT`      | no                     | Default `587`.                                                           |
| `SMTP_USER`      | usually                | SMTP username.                                                           |
| `SMTP_PASS`      | usually                | SMTP password.                                                           |
| `SMTP_SECURE`    | no                     | Defaults to `true` for port 465; other ports use STARTTLS.               |
| `MAIL_FROM`      | no                     | Sender, e.g. `"Patton Secret Santa <santa@example.com>"`.                |

The server won't start in production without `ADMIN_PASSWORD` and
`SESSION_SECRET`.

### Email with Gmail

Turn on 2-step verification, create an
[app password](https://myaccount.google.com/apppasswords), then:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-16-character-app-password
MAIL_FROM="Patton Secret Santa <you@gmail.com>"
```

Any other SMTP provider works the same way (Fastmail, Postmark, SendGrid,
Amazon SES and so on).

## Production

```bash
npm run build
ADMIN_PASSWORD=... SESSION_SECRET=... npm start
```

The server listens on port 3000 (set `PORT` to change it). In production the
login cookie is only sent over HTTPS. If you serve the app over plain http,
for example on a home network, set `COOKIE_SECURE=false` or sign-in won't stick.

### Docker

```bash
docker build -t patton-secret-santa .
docker run -p 3000:3000 \
  -v secret-santa-data:/app/data \
  -e ADMIN_PASSWORD=... \
  -e SESSION_SECRET=... \
  -e SMTP_HOST=... -e SMTP_USER=... -e SMTP_PASS=... -e MAIL_FROM=... \
  patton-secret-santa
```

The volume keeps the database between container restarts. To back it up, copy
`secret-santa.db` from the volume (or from `data/` when running without Docker).

## Project layout

```
app/
├── lib/                    # server-only code
│   ├── assign.server.ts    # the name-drawing algorithm
│   ├── db.server.ts        # SQLite connection and schema
│   ├── draws.server.ts     # making draws and sending emails
│   ├── email.server.ts     # email content and SMTP
│   ├── env.server.ts       # configuration
│   ├── participants.server.ts
│   └── session.server.ts   # admin login
├── routes/
│   ├── home.tsx            # public landing page
│   ├── login.tsx, logout.tsx
│   └── admin/              # organizer pages (login required)
│       ├── layout.tsx      # tabs and the login check
│       ├── participants.tsx
│       ├── assignments.tsx
│       └── history.tsx
└── components/ui.tsx
test/                       # shared test setup and helpers
```

## Tests

```bash
npm test             # run once
npm run test:watch   # rerun on save
```

Tests use [Vitest](https://vitest.dev) and sit next to the code they cover
(`assign.server.test.ts` next to `assign.server.ts`, and so on). Each test file
gets its own throwaway SQLite database, so your real data is never touched, and
no emails are sent. Settings from `.env` are ignored during tests; the fixed
values are in [vitest.config.ts](vitest.config.ts).

Page tests render the real route components with React Testing Library and
jsdom, using the real loaders and actions, so clicking "Make assignments" in a
test really draws names in the test database.
