import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrate, MigrationError } from "./migrate.js";
import { createTestStorage } from "./test/sqlite-shim.js";

let storage: ReturnType<typeof createTestStorage>;

beforeEach(() => {
  storage = createTestStorage();
});

afterEach(() => {
  storage.close();
});

// ---- Helpers ----

function getTrackingVersions(): number[] {
  return storage.sql
    .exec<{ version: number }>(
      "SELECT version FROM __migrations ORDER BY version",
    )
    .toArray()
    .map((r) => r.version);
}

function tableExists(name: string): boolean {
  return (
    storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        name,
      )
      .toArray().length > 0
  );
}

function seedDrizzle(count: number): void {
  storage.sql.exec(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
  for (let i = 0; i < count; i++) {
    storage.sql.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      `hash_${i}`,
      1000 + i,
    );
  }
}

function preSeedMigrations(record: Record<string, string>): void {
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS __migrations (version INTEGER PRIMARY KEY)",
  );
  const keys = Object.keys(record).sort();
  for (const key of keys) {
    const version = parseInt(key.replace("m", ""), 10);
    const stmts = record[key].split("--> statement-breakpoint");
    for (const s of stmts) {
      const trimmed = s.trim();
      if (trimmed) storage.sql.exec(trimmed);
    }
    storage.sql.exec(
      "INSERT INTO __migrations (version) VALUES (?)",
      version,
    );
  }
}

// ---- Migration SQL fixtures ----

const sql1 = "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)";
const sql2 = "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)";
const sql3 = "CREATE TABLE comments (id INTEGER PRIMARY KEY, body TEXT)";
const sql4 = "CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT)";
const sql5 = "CREATE TABLE likes (id INTEGER PRIMARY KEY, userId INTEGER)";

// ---- Tests ----

describe("migrate", () => {
  it("applies a single migration to a fresh database", () => {
    migrate(storage, { m0000: sql1 });

    expect(tableExists("users")).toBe(true);
    expect(getTrackingVersions()).toEqual([0]);
  });

  it("applies multiple migrations to a fresh database", () => {
    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });

    expect(tableExists("users")).toBe(true);
    expect(tableExists("posts")).toBe(true);
    expect(tableExists("comments")).toBe(true);
    expect(getTrackingVersions()).toEqual([0, 1, 2]);
  });

  it("applies only new migrations when some already ran", () => {
    preSeedMigrations({ m0000: sql1, m0001: sql2 });
    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });

    expect(tableExists("comments")).toBe(true);
    expect(getTrackingVersions()).toEqual([0, 1, 2]);
  });

  it("applies multiple new migrations incrementally", () => {
    preSeedMigrations({ m0000: sql1 });
    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });

    expect(tableExists("posts")).toBe(true);
    expect(tableExists("comments")).toBe(true);
    expect(getTrackingVersions()).toEqual([0, 1, 2]);
  });

  it("is a no-op when all migrations are already applied", () => {
    preSeedMigrations({ m0000: sql1, m0001: sql2, m0002: sql3 });
    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });

    expect(getTrackingVersions()).toEqual([0, 1, 2]);
  });

  it("adopts Drizzle migrations and applies new ones", () => {
    seedDrizzle(3);
    storage.sql.exec(sql1);
    storage.sql.exec(sql2);
    storage.sql.exec(sql3);

    migrate(storage, {
      m0000: sql1,
      m0001: sql2,
      m0002: sql3,
      m0003: sql4,
      m0004: sql5,
    });

    expect(tableExists("__drizzle_migrations")).toBe(false);
    expect(getTrackingVersions()).toEqual([0, 1, 2, 3, 4]);
    expect(tableExists("tags")).toBe(true);
    expect(tableExists("likes")).toBe(true);
  });

  it("adopts Drizzle migrations when there are no new ones", () => {
    seedDrizzle(3);
    storage.sql.exec(sql1);
    storage.sql.exec(sql2);
    storage.sql.exec(sql3);

    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });

    expect(tableExists("__drizzle_migrations")).toBe(false);
    expect(getTrackingVersions()).toEqual([0, 1, 2]);
  });

  it("adopts partial Drizzle state and runs remaining migrations", () => {
    seedDrizzle(2);
    storage.sql.exec(sql1);
    storage.sql.exec(sql2);

    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });

    expect(tableExists("__drizzle_migrations")).toBe(false);
    expect(getTrackingVersions()).toEqual([0, 1, 2]);
    expect(tableExists("comments")).toBe(true);
  });

  it("rolls back the transaction on migration failure", () => {
    expect(() =>
      migrate(storage, { m0000: sql1, m0001: "NOT VALID SQL AT ALL" }),
    ).toThrow(MigrationError);

    expect(tableExists("__migrations")).toBe(false);
    expect(tableExists("users")).toBe(false);
  });

  it("includes version, statement, and cause in MigrationError", () => {
    try {
      migrate(storage, {
        m0000: sql1,
        m0001: "CREATE TABLE 123invalid ()",
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MigrationError);
      const err = e as MigrationError;
      expect(err.version).toBe(1);
      expect(err.statement).toContain("123invalid");
      expect(err.message).toContain("Migration 1 failed");
      expect(err.message).toContain(
        "0 migration(s) were applied before this attempt",
      );
    }
  });

  it("handles an empty migrations record as a no-op", () => {
    migrate(storage, {});

    expect(tableExists("__migrations")).toBe(true);
    expect(getTrackingVersions()).toEqual([]);
  });

  it("rejects non-sequential versions", () => {
    expect(() =>
      migrate(storage, { m0000: "SELECT 1", m0002: "SELECT 1" }),
    ).toThrow("expected version 1, got 2");
  });

  it("is idempotent when Drizzle adoption already happened", () => {
    seedDrizzle(2);
    storage.sql.exec(sql1);
    storage.sql.exec(sql2);

    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });
    migrate(storage, { m0000: sql1, m0001: sql2, m0002: sql3 });

    expect(tableExists("__drizzle_migrations")).toBe(false);
    expect(getTrackingVersions()).toEqual([0, 1, 2]);
  });

  it("handles multi-statement migrations with --> statement-breakpoint", () => {
    const multi = [
      "CREATE TABLE a (id INTEGER PRIMARY KEY)",
      "--> statement-breakpoint",
      "CREATE TABLE b (id INTEGER PRIMARY KEY)",
    ].join("\n");

    migrate(storage, { m0000: multi });

    expect(tableExists("a")).toBe(true);
    expect(tableExists("b")).toBe(true);
    expect(getTrackingVersions()).toEqual([0]);
  });

  it("rejects when Drizzle has more migrations than provided", () => {
    seedDrizzle(3);
    storage.sql.exec(sql1);
    storage.sql.exec(sql2);
    storage.sql.exec(sql3);

    expect(() => migrate(storage, { m0000: sql1 })).toThrow(
      "Drizzle has 3 migrations but only 1 were provided",
    );
  });

  it("rejects invalid key formats", () => {
    expect(() => migrate(storage, { migration1: "SELECT 1" })).toThrow(
      'Invalid migration key "migration1"',
    );
    expect(() => migrate(storage, { m001: "SELECT 1" })).toThrow(
      'Invalid migration key "m001"',
    );
    expect(() => migrate(storage, { m00001: "SELECT 1" })).toThrow(
      'Invalid migration key "m00001"',
    );
  });
});
