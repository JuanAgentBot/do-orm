/**
 * Migration runner for DO SQLite.
 *
 * Tracks applied migrations in a __migrations table.
 * Each migration is a SQL string or array of SQL strings.
 * Only unapplied migrations run. All new migrations execute
 * in a single transaction (all-or-nothing).
 */

import type { DOStorage } from "./db.js";

type Migration = string | string[];

/**
 * Run pending migrations against DO storage.
 *
 * Migrations are identified by their array index (0, 1, 2, ...).
 * On each call, only migrations after the last applied index are executed.
 * Call this in your Durable Object constructor.
 *
 * @example
 * ```ts
 * migrate(ctx.storage, [
 *   `CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`,
 *   `ALTER TABLE "users" ADD COLUMN "email" TEXT`,
 * ]);
 * ```
 */
export function migrate(storage: DOStorage, migrations: Migration[]): void {
  storage.transactionSync(() => {
    storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS "__migrations" ("idx" INTEGER PRIMARY KEY, "applied_at" TEXT NOT NULL)`,
    );

    const rows = storage.sql
      .exec<{ idx: number }>(
        `SELECT "idx" FROM "__migrations" ORDER BY "idx" DESC LIMIT 1`,
      )
      .toArray();
    const lastApplied = rows.length > 0 ? rows[0].idx : -1;

    for (let i = lastApplied + 1; i < migrations.length; i++) {
      const migration = migrations[i];
      const statements = Array.isArray(migration) ? migration : [migration];

      for (const stmt of statements) {
        storage.sql.exec(stmt);
      }

      storage.sql.exec(
        `INSERT INTO "__migrations" ("idx", "applied_at") VALUES (?, ?)`,
        i,
        new Date().toISOString(),
      );
    }
  });
}
