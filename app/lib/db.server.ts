import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { env } from "./env.server";

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// Each entry runs once, in order. Append new ones; never edit old ones.
const migrations = [
  `
  -- AUTOINCREMENT so ids are never reused: a form on a stale page must not
  -- act on a different row that happens to get the same id.
  CREATE TABLE participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE draws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  -- Names and emails are copied in so history survives removing a participant.
  CREATE TABLE assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draw_id INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
    giver_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
    giver_name TEXT NOT NULL,
    giver_email TEXT NOT NULL,
    receiver_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
    receiver_name TEXT NOT NULL,
    email_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (email_status IN ('pending', 'sent', 'logged', 'failed')),
    email_error TEXT,
    emailed_at TEXT
  );

  CREATE INDEX assignments_draw_id ON assignments(draw_id);
  `,
  `
  -- Each row means the giver must never be given the receiver to buy for.
  -- The app allows up to two per giver.
  CREATE TABLE restrictions (
    giver_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    PRIMARY KEY (giver_id, receiver_id),
    CHECK (giver_id <> receiver_id)
  );
  `,
];

function open() {
  const path = resolve(env.databasePath);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  const { user_version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let version = user_version; version < migrations.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}

// Reuse one connection across dev-server hot reloads.
const cache = globalThis as { __secretSantaDb?: DatabaseSync };
const db = (cache.__secretSantaDb ??= open());

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
