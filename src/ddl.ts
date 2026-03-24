/**
 * DDL generation from do-orm schema definitions.
 *
 * Generates CREATE TABLE SQL from table() definitions so you
 * don't have to hand-write the initial migration.
 */

import type { TableDef, ColumnsRecord } from "./schema.js";

/**
 * Generate a CREATE TABLE IF NOT EXISTS statement from a table definition.
 *
 * @example
 * ```ts
 * const users = table('users', {
 *   id: column.integer().primaryKey().autoIncrement(),
 *   name: column.text().notNull(),
 * });
 *
 * createTableSql(users);
 * // CREATE TABLE IF NOT EXISTS "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL)
 * ```
 */
export function createTableSql<C extends ColumnsRecord>(
  tableDef: TableDef<C>,
): string {
  const colDefs: string[] = [];

  for (const [name, col] of Object.entries(tableDef.columns)) {
    const parts: string[] = [`"${name}"`];

    parts.push(col.type === "integer" ? "INTEGER" : "TEXT");

    if (col.primaryKey) parts.push("PRIMARY KEY");
    if (col.autoIncrement) parts.push("AUTOINCREMENT");
    if (!col.nullable && !col.primaryKey) parts.push("NOT NULL");
    if (col.unique) parts.push("UNIQUE");

    if (col.defaultValue !== undefined) {
      if (typeof col.defaultValue === "string") {
        // Escape single quotes in default values
        const escaped = (col.defaultValue as string).replace(/'/g, "''");
        parts.push(`DEFAULT '${escaped}'`);
      } else {
        parts.push(`DEFAULT ${col.defaultValue}`);
      }
    }

    if (col.references) {
      const ref = col.references();
      parts.push(`REFERENCES "${ref.table}" ("${ref.column}")`);
    }

    colDefs.push(parts.join(" "));
  }

  return `CREATE TABLE IF NOT EXISTS "${tableDef.name}" (${colDefs.join(", ")})`;
}
