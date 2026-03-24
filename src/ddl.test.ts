import { describe, it, expect } from "vitest";
import { table, column, ref } from "./schema.js";
import { createTableSql } from "./ddl.js";

describe("createTableSql()", () => {
  it("generates basic table", () => {
    const users = table("users", {
      id: column.integer().primaryKey(),
      name: column.text().notNull(),
    });

    expect(createTableSql(users)).toBe(
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`,
    );
  });

  it("handles autoincrement", () => {
    const t = table("items", {
      id: column.integer().primaryKey().autoIncrement(),
    });

    expect(createTableSql(t)).toContain("PRIMARY KEY AUTOINCREMENT");
  });

  it("handles nullable columns (default)", () => {
    const t = table("t", {
      notes: column.text(),
    });

    const sql = createTableSql(t);
    expect(sql).not.toContain("NOT NULL");
  });

  it("handles unique constraint", () => {
    const t = table("t", {
      email: column.text().notNull().unique(),
    });

    expect(createTableSql(t)).toContain("NOT NULL UNIQUE");
  });

  it("handles text default value", () => {
    const t = table("t", {
      role: column.text().notNull().default("user"),
    });

    expect(createTableSql(t)).toContain(`DEFAULT 'user'`);
  });

  it("handles integer default value", () => {
    const t = table("t", {
      count: column.integer().notNull().default(0),
    });

    expect(createTableSql(t)).toContain("DEFAULT 0");
  });

  it("escapes single quotes in default values", () => {
    const t = table("t", {
      label: column.text().notNull().default("it's"),
    });

    expect(createTableSql(t)).toContain(`DEFAULT 'it''s'`);
  });

  it("handles foreign key references", () => {
    const users = table("users", {
      id: column.integer().primaryKey(),
    });

    const posts = table("posts", {
      id: column.integer().primaryKey(),
      authorId: column.integer().notNull().references(ref(users, "id")),
    });

    expect(createTableSql(posts)).toContain(
      `REFERENCES "users" ("id")`,
    );
  });

  it("generates a complete table with all features", () => {
    const users = table("users", {
      id: column.integer().primaryKey().autoIncrement(),
      name: column.text().notNull(),
      email: column.text().unique(),
      role: column.text().notNull().default("user"),
    });

    const sql = createTableSql(users);
    expect(sql).toBe(
      `CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "email" TEXT UNIQUE, "role" TEXT NOT NULL DEFAULT 'user')`,
    );
  });
});
