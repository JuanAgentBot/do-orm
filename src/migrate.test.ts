import { describe, it, expect, beforeEach } from "vitest";
import { migrate } from "./migrate.js";
import { createMockStorage } from "./test-utils.js";

describe("migrate()", () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it("runs all migrations on first call", () => {
    migrate(storage, [
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS "posts" ("id" INTEGER PRIMARY KEY, "title" TEXT NOT NULL)`,
    ]);

    expect(storage.tables.has("users")).toBe(true);
    expect(storage.tables.has("posts")).toBe(true);

    const migrations = storage.tables.get("__migrations")!;
    expect(migrations).toHaveLength(2);
    expect(migrations[0].idx).toBe(0);
    expect(migrations[1].idx).toBe(1);
  });

  it("skips already-applied migrations", () => {
    migrate(storage, [
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)`,
    ]);

    expect(storage.tables.get("__migrations")).toHaveLength(1);

    // Add a second migration
    migrate(storage, [
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)`,
      `CREATE TABLE IF NOT EXISTS "posts" ("id" INTEGER PRIMARY KEY)`,
    ]);

    expect(storage.tables.has("posts")).toBe(true);
    expect(storage.tables.get("__migrations")).toHaveLength(2);
  });

  it("handles multi-statement migrations", () => {
    migrate(storage, [
      [
        `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)`,
        `CREATE TABLE IF NOT EXISTS "posts" ("id" INTEGER PRIMARY KEY)`,
      ],
    ]);

    expect(storage.tables.has("users")).toBe(true);
    expect(storage.tables.has("posts")).toBe(true);

    // Only one migration entry for the grouped statements
    const migrations = storage.tables.get("__migrations")!;
    expect(migrations).toHaveLength(1);
    expect(migrations[0].idx).toBe(0);
  });

  it("does nothing when no migrations provided", () => {
    migrate(storage, []);

    // __migrations table created but empty
    expect(storage.tables.has("__migrations")).toBe(true);
    expect(storage.tables.get("__migrations")).toHaveLength(0);
  });

  it("does nothing when all migrations already applied", () => {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)`,
    ];

    migrate(storage, migrations);
    const countAfterFirst = storage.statements.length;

    migrate(storage, migrations);

    // Second call: CREATE TABLE __migrations + SELECT + nothing else
    // No INSERT into __migrations, no user migration SQL
    const newStatements = storage.statements.slice(countAfterFirst);
    const migrationInserts = newStatements.filter(
      (s) => s.sql.includes("INSERT") && s.sql.includes("__migrations"),
    );
    expect(migrationInserts).toHaveLength(0);
  });

  it("mixes string and array migrations", () => {
    migrate(storage, [
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)`,
      [
        `CREATE TABLE IF NOT EXISTS "posts" ("id" INTEGER PRIMARY KEY)`,
        `CREATE TABLE IF NOT EXISTS "tags" ("id" INTEGER PRIMARY KEY)`,
      ],
      `CREATE TABLE IF NOT EXISTS "comments" ("id" INTEGER PRIMARY KEY)`,
    ]);

    expect(storage.tables.has("users")).toBe(true);
    expect(storage.tables.has("posts")).toBe(true);
    expect(storage.tables.has("tags")).toBe(true);
    expect(storage.tables.has("comments")).toBe(true);

    expect(storage.tables.get("__migrations")).toHaveLength(3);
  });

  it("records applied_at timestamp", () => {
    migrate(storage, [
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY)`,
    ]);

    const entry = storage.tables.get("__migrations")![0];
    expect(entry.applied_at).toBeDefined();
    expect(typeof entry.applied_at).toBe("string");
    // Should be a valid ISO timestamp
    expect(new Date(entry.applied_at as string).getTime()).not.toBeNaN();
  });
});
