/**
 * Thin shim adapting better-sqlite3 to the DOStorage interface.
 * Used only in tests. Keeps the library free of Node/CF runtime coupling.
 */

import Database from "better-sqlite3";
import type { DOStorage, SqlStorage } from "../db.js";

export function createTestStorage(): DOStorage & { close(): void } {
  const db = new Database(":memory:");

  const sql: SqlStorage = {
    exec(
      query: string,
      ...bindings: unknown[]
    ) {
      const stmt = db.prepare(query);
      if (stmt.reader) {
        const rows = stmt.all(...bindings) as Record<string, unknown>[];
        return {
          toArray: () => rows,
          one: () => {
            if (rows.length !== 1) {
              throw new Error(`Expected exactly 1 row, got ${rows.length}`);
            }
            return rows[0];
          },
          [Symbol.iterator]: function* () {
            yield* rows;
          },
        };
      }
      stmt.run(...bindings);
      return {
        toArray: () => [] as Record<string, unknown>[],
        one: (): Record<string, unknown> => {
          throw new Error("Expected exactly 1 row, got 0");
        },
        [Symbol.iterator]: function* (): IterableIterator<Record<string, unknown>> {
          // empty
        },
      };
    },
  };

  return {
    sql,
    transactionSync<T>(closure: () => T): T {
      const txn = db.transaction(closure);
      return txn();
    },
    close() {
      db.close();
    },
  };
}
