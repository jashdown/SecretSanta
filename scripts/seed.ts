// Fills the database with sample people, restrictions and two past draws, so
// every page has something to show. Run with `npm run db:seed`; add
// `-- --reset` to empty the database first.
//
// Emails use example.com, so nothing can reach a real inbox even with SMTP set up.

import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

// Loaded through Vite so the app's imports resolve as they do in the app, and
// so the schema migrations run before anything is inserted.
const { module: db } = await runnerImport<typeof import("../app/lib/db.server")>(
  fileURLToPath(new URL("../app/lib/db.server.ts", import.meta.url)),
  { configFile: false, resolve: { tsconfigPaths: true }, logLevel: "warn" },
);

const reset = process.argv.includes("--reset");

const people = {
  alice: { name: "Alice Johnson", email: "alice@example.com", joined: "2024-11-02T10:15:00.000Z" },
  ben: { name: "Ben Johnson", email: "ben@example.com", joined: "2024-11-02T10:16:00.000Z" },
  chloe: { name: "Chloe Martin", email: "chloe@example.com", joined: "2024-11-02T10:18:00.000Z" },
  dan: { name: "Dan Martin", email: "dan@example.com", joined: "2024-11-02T10:19:00.000Z" },
  emma: { name: "Emma Wilson", email: "emma@example.com", joined: "2024-11-02T10:21:00.000Z" },
  frank: { name: "Frank Wilson", email: "frank@example.com", joined: "2024-11-02T10:22:00.000Z" },
  grace: { name: "Grace Lee", email: "grace@example.com", joined: "2024-11-03T18:40:00.000Z" },
  // Took part in 2024 and 2025, then was removed, so history keeps a removed person.
  ray: { name: "Ray Patel", email: "ray@example.com", joined: "2024-11-03T18:42:00.000Z" },
  // Joined this year, so the latest draw is out of date and asks for a redraw.
  hiro: { name: "Hiro Tanaka", email: "hiro@example.com", joined: "2026-10-24T09:05:00.000Z" },
};
type Person = keyof typeof people;

const removed: Person[] = ["ray"];

// Couples can't draw each other, and Emma can't draw Grace either.
const restrictions: [giver: Person, receiver: Person][] = [
  ["alice", "ben"],
  ["ben", "alice"],
  ["chloe", "dan"],
  ["dan", "chloe"],
  ["emma", "frank"],
  ["emma", "grace"],
  ["frank", "emma"],
];

// Each loop follows the restrictions above, and 2025 repeats no 2024 pairing,
// just as the app would draw them.
const draws: { name: string; createdAt: string; emailedAt: string; loop: Person[] }[] = [
  {
    name: "Patton Secret Santa 2024",
    createdAt: "2024-11-20T19:30:00.000Z",
    emailedAt: "2024-11-20T19:32:00.000Z",
    loop: ["alice", "chloe", "ben", "emma", "dan", "grace", "frank", "ray"],
  },
  {
    name: "Patton Secret Santa 2025",
    createdAt: "2025-11-18T20:05:00.000Z",
    emailedAt: "2025-11-18T20:06:00.000Z",
    loop: ["alice", "dan", "emma", "ray", "chloe", "frank", "ben", "grace"],
  },
];

const existing = db.get<{ n: number }>(
  "SELECT (SELECT COUNT(*) FROM participants) + (SELECT COUNT(*) FROM draws) AS n",
)!.n;
if (existing > 0 && !reset) {
  console.error(
    "The database already has data, so nothing was added.\n" +
      "To replace everything with the sample data, run: npm run db:seed -- --reset",
  );
  process.exit(1);
}

db.transaction(() => {
  if (reset) {
    // Same order as the test helper's resetDb, children before parents.
    db.run("DELETE FROM restrictions");
    db.run("DELETE FROM assignments");
    db.run("DELETE FROM draws");
    db.run("DELETE FROM participants");
  }

  const ids = {} as Record<Person, number>;
  for (const [key, p] of Object.entries(people) as [Person, (typeof people)[Person]][]) {
    ids[key] = Number(
      db.run(
        "INSERT INTO participants (name, email, created_at) VALUES (?, ?, ?)",
        p.name,
        p.email,
        p.joined,
      ).lastInsertRowid,
    );
  }

  for (const [giver, receiver] of restrictions) {
    db.run(
      "INSERT INTO restrictions (giver_id, receiver_id) VALUES (?, ?)",
      ids[giver],
      ids[receiver],
    );
  }

  for (const draw of draws) {
    const drawId = Number(
      db.run("INSERT INTO draws (name, created_at) VALUES (?, ?)", draw.name, draw.createdAt)
        .lastInsertRowid,
    );
    // Stored sorted by giver, as the app does, so the order doesn't reveal the loop.
    const pairs = draw.loop
      .map((giver, i) => ({ giver, receiver: draw.loop[(i + 1) % draw.loop.length] }))
      .sort((a, b) => ids[a.giver] - ids[b.giver]);
    for (const { giver, receiver } of pairs) {
      db.run(
        `INSERT INTO assignments
           (draw_id, giver_id, giver_name, giver_email, receiver_id, receiver_name,
            email_status, emailed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'sent', ?)`,
        drawId,
        ids[giver],
        people[giver].name,
        people[giver].email,
        ids[receiver],
        people[receiver].name,
        draw.emailedAt,
      );
    }
  }

  // Removing someone clears their ids from past assignments but keeps the
  // copied names, the same as removing them in the app.
  for (const key of removed) {
    db.run("DELETE FROM participants WHERE id = ?", ids[key]);
  }
});

const current = Object.keys(people).length - removed.length;
console.log(
  `Added ${current} participants, ${restrictions.length} restrictions and ${draws.length} past draws` +
    ` (${draws.map((d) => d.name).join(", ")}).`,
);
