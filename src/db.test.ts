import { describe, it, expect, beforeEach } from "vitest";
import { table, column, createDb, eq, ne, lt, lte, gt, gte, and, asc, desc } from "./index.js";
import { createMockStorage } from "./test-utils.js";
import type { InferRow, InferInsert } from "./index.js";

// Define test schema
const users = table("users", {
  id: column.integer().primaryKey().autoIncrement(),
  name: column.text().notNull(),
  email: column.text(),
  role: column.text().notNull().default("user"),
});

const posts = table("posts", {
  id: column.integer().primaryKey().autoIncrement(),
  title: column.text().notNull(),
  authorId: column.integer().notNull(),
  status: column.text().notNull().default("draft"),
  createdAt: column.text().notNull(),
});

// Type tests (compile-time checks)
type UserRow = InferRow<(typeof users)["columns"]>;
type UserInsert = InferInsert<(typeof users)["columns"]>;

// These should compile without errors:
const _typeCheckRow: UserRow = {
  id: 1,
  name: "Alice",
  email: null,
  role: "admin",
};

const _typeCheckInsert1: UserInsert = {
  name: "Alice",
  // id, email, role are all optional
};

const _typeCheckInsert2: UserInsert = {
  name: "Bob",
  email: "bob@example.com",
  role: "admin",
};

describe("Database", () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
    storage.tables.set("users", [
      { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
      { id: 2, name: "Bob", email: null, role: "user" },
      { id: 3, name: "Charlie", email: "charlie@example.com", role: "user" },
    ]);
    storage.tables.set("posts", [
      {
        id: 1,
        title: "Hello",
        authorId: 1,
        status: "published",
        createdAt: "2026-01-01",
      },
      {
        id: 2,
        title: "World",
        authorId: 1,
        status: "draft",
        createdAt: "2026-01-02",
      },
      {
        id: 3,
        title: "Foo",
        authorId: 2,
        status: "published",
        createdAt: "2026-01-03",
      },
    ]);
  });

  describe("all()", () => {
    it("selects all rows", () => {
      const db = createDb(storage);
      const result = db.all(users);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: 1,
        name: "Alice",
        email: "alice@example.com",
        role: "admin",
      });
    });

    it("generates correct SQL", () => {
      const db = createDb(storage);
      db.all(users);

      expect(storage.statements[0].sql).toBe(
        'SELECT "id", "name", "email", "role" FROM "users"',
      );
      expect(storage.statements[0].params).toEqual([]);
    });

    it("filters with where", () => {
      const db = createDb(storage);
      const result = db.all(users, { where: eq("role", "user") });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Bob");
      expect(result[1].name).toBe("Charlie");

      expect(storage.statements[0].sql).toBe(
        'SELECT "id", "name", "email", "role" FROM "users" WHERE "role" = ?',
      );
      expect(storage.statements[0].params).toEqual(["user"]);
    });

    it("orders ascending", () => {
      const db = createDb(storage);
      const result = db.all(users, { orderBy: asc("name") });

      expect(result[0].name).toBe("Alice");
      expect(result[2].name).toBe("Charlie");

      expect(storage.statements[0].sql).toContain('ORDER BY "name" ASC');
    });

    it("orders descending", () => {
      const db = createDb(storage);
      const result = db.all(users, { orderBy: desc("name") });

      expect(result[0].name).toBe("Charlie");
      expect(result[2].name).toBe("Alice");

      expect(storage.statements[0].sql).toContain('ORDER BY "name" DESC');
    });

    it("limits results", () => {
      const db = createDb(storage);
      const result = db.all(users, { limit: 2 });

      expect(result).toHaveLength(2);
      expect(storage.statements[0].sql).toContain("LIMIT ?");
      expect(storage.statements[0].params).toEqual([2]);
    });

    it("combines where, orderBy, and limit", () => {
      const db = createDb(storage);
      const result = db.all(users, {
        where: eq("role", "user"),
        orderBy: desc("name"),
        limit: 1,
      });

      expect(result).toHaveLength(1);

      expect(storage.statements[0].sql).toBe(
        'SELECT "id", "name", "email", "role" FROM "users" WHERE "role" = ? ORDER BY "name" DESC LIMIT ?',
      );
      expect(storage.statements[0].params).toEqual(["user", 1]);
    });
  });

  describe("get()", () => {
    it("returns first matching row", () => {
      const db = createDb(storage);
      const result = db.get(users, { where: eq("id", 1) });

      expect(result).toEqual({
        id: 1,
        name: "Alice",
        email: "alice@example.com",
        role: "admin",
      });
    });

    it("returns undefined when not found", () => {
      const db = createDb(storage);
      const result = db.get(users, { where: eq("id", 999) });

      expect(result).toBeUndefined();
    });

    it("adds LIMIT 1", () => {
      const db = createDb(storage);
      db.get(users);

      expect(storage.statements[0].sql).toContain("LIMIT ?");
      expect(storage.statements[0].params).toEqual([1]);
    });
  });

  describe("count()", () => {
    it("counts all rows", () => {
      const db = createDb(storage);
      const result = db.count(users);

      expect(result).toBe(3);
      expect(storage.statements[0].sql).toBe(
        'SELECT COUNT(*) AS "count" FROM "users"',
      );
    });

    it("counts with where", () => {
      const db = createDb(storage);
      const result = db.count(users, { where: eq("role", "user") });

      expect(result).toBe(2);
      expect(storage.statements[0].sql).toBe(
        'SELECT COUNT(*) AS "count" FROM "users" WHERE "role" = ?',
      );
    });
  });

  describe("insert()", () => {
    it("inserts a row", () => {
      const db = createDb(storage);
      db.insert(users, { name: "Dave", email: "dave@example.com", role: "user" });

      expect(storage.statements[0].sql).toBe(
        'INSERT INTO "users" ("name", "email", "role") VALUES (?, ?, ?)',
      );
      expect(storage.statements[0].params).toEqual([
        "Dave",
        "dave@example.com",
        "user",
      ]);

      const rows = storage.tables.get("users")!;
      expect(rows).toHaveLength(4);
      expect(rows[3].name).toBe("Dave");
    });
  });

  describe("insertReturning()", () => {
    it("inserts and returns specified columns", () => {
      const db = createDb(storage);
      const result = db.insertReturning(
        users,
        { name: "Eve", role: "admin" },
        ["id"],
      );

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("number");

      expect(storage.statements[0].sql).toContain('RETURNING "id"');
    });
  });

  describe("update()", () => {
    it("updates matching rows", () => {
      const db = createDb(storage);
      db.update(users, { email: "newalice@example.com" }, { where: eq("id", 1) });

      expect(storage.statements[0].sql).toBe(
        'UPDATE "users" SET "email" = ? WHERE "id" = ?',
      );
      expect(storage.statements[0].params).toEqual(["newalice@example.com", 1]);

      const alice = storage.tables.get("users")![0];
      expect(alice.email).toBe("newalice@example.com");
    });

    it("updates all rows without where", () => {
      const db = createDb(storage);
      db.update(users, { role: "viewer" });

      expect(storage.statements[0].sql).toBe(
        'UPDATE "users" SET "role" = ?',
      );

      const rows = storage.tables.get("users")!;
      expect(rows.every((r) => r.role === "viewer")).toBe(true);
    });

    it("skips undefined values", () => {
      const db = createDb(storage);
      db.update(users, { email: "x@y.com", role: undefined } as any, {
        where: eq("id", 1),
      });

      expect(storage.statements[0].sql).toBe(
        'UPDATE "users" SET "email" = ? WHERE "id" = ?',
      );
      expect(storage.statements[0].params).toEqual(["x@y.com", 1]);
    });

    it("does nothing when all values are undefined", () => {
      const db = createDb(storage);
      db.update(users, {} as any);

      expect(storage.statements).toHaveLength(0);
    });
  });

  describe("delete()", () => {
    it("deletes matching rows", () => {
      const db = createDb(storage);
      db.delete(users, { where: eq("id", 2) });

      expect(storage.statements[0].sql).toBe(
        'DELETE FROM "users" WHERE "id" = ?',
      );
      expect(storage.statements[0].params).toEqual([2]);

      const rows = storage.tables.get("users")!;
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === 2)).toBeUndefined();
    });

    it("deletes all rows without where", () => {
      const db = createDb(storage);
      db.delete(users);

      expect(storage.statements[0].sql).toBe('DELETE FROM "users"');
      expect(storage.tables.get("users")).toEqual([]);
    });
  });

  describe("select()", () => {
    it("selects specific columns", () => {
      const db = createDb(storage);
      const result = db.select(users, ["id", "name"]);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 1, name: "Alice" });
      expect(result[1]).toEqual({ id: 2, name: "Bob" });
    });

    it("generates SQL with only specified columns", () => {
      const db = createDb(storage);
      db.select(users, ["id", "name"]);

      expect(storage.statements[0].sql).toBe(
        'SELECT "id", "name" FROM "users"',
      );
    });

    it("supports where, orderBy, and limit", () => {
      const db = createDb(storage);
      const result = db.select(posts, ["id", "title"], {
        where: eq("authorId", 1),
        orderBy: desc("id"),
        limit: 1,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 2, title: "World" });

      expect(storage.statements[0].sql).toBe(
        'SELECT "id", "title" FROM "posts" WHERE "authorId" = ? ORDER BY "id" DESC LIMIT ?',
      );
    });

    it("selects a single column", () => {
      const db = createDb(storage);
      const result = db.select(users, ["email"]);

      expect(result).toEqual([
        { email: "alice@example.com" },
        { email: null },
        { email: "charlie@example.com" },
      ]);
    });
  });

  describe("selectOne()", () => {
    it("returns one projected row", () => {
      const db = createDb(storage);
      const result = db.selectOne(users, ["id", "name"], {
        where: eq("id", 1),
      });

      expect(result).toEqual({ id: 1, name: "Alice" });
    });

    it("returns undefined when not found", () => {
      const db = createDb(storage);
      const result = db.selectOne(users, ["id", "name"], {
        where: eq("id", 999),
      });

      expect(result).toBeUndefined();
    });

    it("adds LIMIT 1", () => {
      const db = createDb(storage);
      db.selectOne(users, ["id"]);

      expect(storage.statements[0].sql).toContain("LIMIT ?");
      expect(storage.statements[0].params).toEqual([1]);
    });
  });

  describe("ne() condition", () => {
    it("filters with not-equal", () => {
      const db = createDb(storage);
      const result = db.all(users, { where: ne("role", "admin") });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Bob");
      expect(result[1].name).toBe("Charlie");
    });

    it("generates != SQL", () => {
      const db = createDb(storage);
      db.all(users, { where: ne("role", "admin") });

      expect(storage.statements[0].sql).toContain('"role" != ?');
      expect(storage.statements[0].params).toEqual(["admin"]);
    });
  });

  describe("lt() condition", () => {
    it("filters with less-than", () => {
      const db = createDb(storage);
      const result = db.all(posts, { where: lt("id", 3) });

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("Hello");
      expect(result[1].title).toBe("World");
    });

    it("generates < SQL", () => {
      const db = createDb(storage);
      db.all(posts, { where: lt("id", 3) });

      expect(storage.statements[0].sql).toContain('"id" < ?');
      expect(storage.statements[0].params).toEqual([3]);
    });
  });

  describe("lte() condition", () => {
    it("filters with less-than-or-equal", () => {
      const db = createDb(storage);
      const result = db.all(posts, { where: lte("id", 2) });

      expect(result).toHaveLength(2);
    });

    it("generates <= SQL", () => {
      const db = createDb(storage);
      db.all(posts, { where: lte("id", 2) });

      expect(storage.statements[0].sql).toContain('"id" <= ?');
    });
  });

  describe("gt() condition", () => {
    it("filters with greater-than", () => {
      const db = createDb(storage);
      const result = db.all(posts, { where: gt("id", 1) });

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("World");
      expect(result[1].title).toBe("Foo");
    });

    it("generates > SQL", () => {
      const db = createDb(storage);
      db.all(posts, { where: gt("id", 1) });

      expect(storage.statements[0].sql).toContain('"id" > ?');
    });
  });

  describe("gte() condition", () => {
    it("filters with greater-than-or-equal", () => {
      const db = createDb(storage);
      const result = db.all(posts, { where: gte("id", 2) });

      expect(result).toHaveLength(2);
    });

    it("generates >= SQL", () => {
      const db = createDb(storage);
      db.all(posts, { where: gte("id", 2) });

      expect(storage.statements[0].sql).toContain('"id" >= ?');
    });
  });

  describe("comparison operators with and()", () => {
    it("supports cursor pagination pattern", () => {
      const db = createDb(storage);
      const result = db.all(posts, {
        where: and(lt("id", 3), gte("createdAt", "2026-01-01")),
        orderBy: desc("id"),
        limit: 10,
      });

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("World");
      expect(result[1].title).toBe("Hello");

      expect(storage.statements[0].sql).toContain(
        'WHERE ("id" < ?) AND ("createdAt" >= ?)',
      );
      expect(storage.statements[0].params).toEqual([3, "2026-01-01", 10]);
    });
  });

  describe("and() condition", () => {
    it("combines multiple conditions", () => {
      const db = createDb(storage);
      const result = db.all(posts, {
        where: and(eq("authorId", 1), eq("status", "published")),
      });

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Hello");

      expect(storage.statements[0].sql).toContain(
        'WHERE ("authorId" = ?) AND ("status" = ?)',
      );
      expect(storage.statements[0].params).toEqual([1, "published"]);
    });
  });

  describe("transaction()", () => {
    it("wraps operations in transactionSync", () => {
      const db = createDb(storage);
      let called = false;

      const result = db.transaction(() => {
        called = true;
        db.insert(users, { name: "TxUser", role: "user" });
        return "done";
      });

      expect(called).toBe(true);
      expect(result).toBe("done");
      expect(storage.tables.get("users")!).toHaveLength(4);
    });
  });

  describe("raw()", () => {
    it("executes raw SQL", () => {
      const db = createDb(storage);
      db.raw('CREATE TABLE IF NOT EXISTS "test" (id INTEGER PRIMARY KEY)');

      expect(storage.statements[0].sql).toBe(
        'CREATE TABLE IF NOT EXISTS "test" (id INTEGER PRIMARY KEY)',
      );
    });
  });
});
