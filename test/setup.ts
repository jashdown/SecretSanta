import "@testing-library/jest-dom/vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach } from "vitest";

// Each test file gets its own throwaway database, so files can run in parallel
// and never touch data/secret-santa.db.
const dir = mkdtempSync(join(tmpdir(), "secret-santa-test-"));
process.env.DATABASE_PATH = join(dir, "test.db");

afterAll(() => {
  const cache = globalThis as { __secretSantaDb?: DatabaseSync };
  cache.__secretSantaDb?.close();
  delete cache.__secretSantaDb;
  rmSync(dir, { recursive: true, force: true });
});

// Unmount whatever React Testing Library rendered (jsdom tests only).
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
