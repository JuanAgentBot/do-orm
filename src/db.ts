/**
 * Database wrapper for DO SQLite.
 *
 * Provides typed CRUD operations over ctx.storage.sql.
 * Each method generates a SQL string + bindings and calls exec().
 */

import type { TableDef, InferRow, InferInsert, ColumnsRecord } from "./schema.js";
import type { Condition } from "./conditions.js";

// Minimal interface matching Cloudflare's SqlStorage
export interface SqlStorage {
  exec<T extends Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): SqlCursor<T>;
}

interface SqlCursor<T> {
  toArray(): T[];
  one(): T;
  [Symbol.iterator](): IterableIterator<T>;
}

// Minimal interface matching DurableObjectStorage
export interface DOStorage {
  sql: SqlStorage;
  transactionSync<T>(fn: () => T): T;
}

type OrderDirection = "asc" | "desc";

interface SelectOptions {
  where?: Condition;
  orderBy?: { column: string; direction: OrderDirection };
  limit?: number;
}

interface ReturningColumn {
  name: string;
  alias?: string;
}

export class Database {
  constructor(private storage: DOStorage) {}

  /**
   * Select all rows from a table. Returns typed array.
   */
  all<C extends ColumnsRecord>(
    table: TableDef<C>,
    options?: SelectOptions,
  ): InferRow<C>[] {
    const { sql, params } = this.buildSelect(table, options);
    return this.exec<InferRow<C>>(sql, params);
  }

  /**
   * Select a single row. Returns undefined if not found.
   */
  get<C extends ColumnsRecord>(
    table: TableDef<C>,
    options?: SelectOptions,
  ): InferRow<C> | undefined {
    const effectiveOptions = { ...options, limit: 1 };
    const { sql, params } = this.buildSelect(table, effectiveOptions);
    const rows = this.exec<InferRow<C>>(sql, params);
    return rows[0];
  }

  /**
   * Count rows, optionally filtered.
   */
  count<C extends ColumnsRecord>(
    table: TableDef<C>,
    options?: { where?: Condition },
  ): number {
    let sql = `SELECT COUNT(*) AS "count" FROM "${table.name}"`;
    const params: unknown[] = [];

    if (options?.where) {
      const cond = options.where.toSql();
      sql += ` WHERE ${cond.sql}`;
      params.push(...cond.params);
    }

    const rows = this.exec<{ count: number }>(sql, params);
    return rows[0]?.count ?? 0;
  }

  /**
   * Insert a row. Returns nothing by default.
   */
  insert<C extends ColumnsRecord>(
    table: TableDef<C>,
    values: InferInsert<C>,
  ): void {
    const { sql, params } = this.buildInsert(table, values);
    this.exec(sql, params);
  }

  /**
   * Insert a row and return specified columns.
   */
  insertReturning<C extends ColumnsRecord, K extends keyof C & string>(
    table: TableDef<C>,
    values: InferInsert<C>,
    returning: K[],
  ): Pick<InferRow<C>, K> {
    const { sql: insertSql, params } = this.buildInsert(table, values);
    const retCols = returning.map((k) => `"${k}"`).join(", ");
    const sql = `${insertSql} RETURNING ${retCols}`;
    const rows = this.exec<Pick<InferRow<C>, K>>(sql, params);
    return rows[0];
  }

  /**
   * Update rows. Without `where`, updates all rows.
   */
  update<C extends ColumnsRecord>(
    table: TableDef<C>,
    values: Partial<InferRow<C>>,
    options?: { where?: Condition },
  ): void {
    const entries = Object.entries(values as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return;

    const setClauses = entries.map(([k]) => `"${k}" = ?`);
    const params = entries.map(([, v]) => v);

    let sql = `UPDATE "${table.name}" SET ${setClauses.join(", ")}`;

    if (options?.where) {
      const cond = options.where.toSql();
      sql += ` WHERE ${cond.sql}`;
      params.push(...cond.params);
    }

    this.exec(sql, params);
  }

  /**
   * Delete rows. Without `where`, deletes all rows.
   */
  delete<C extends ColumnsRecord>(
    table: TableDef<C>,
    options?: { where?: Condition },
  ): void {
    let sql = `DELETE FROM "${table.name}"`;
    const params: unknown[] = [];

    if (options?.where) {
      const cond = options.where.toSql();
      sql += ` WHERE ${cond.sql}`;
      params.push(...cond.params);
    }

    this.exec(sql, params);
  }

  /**
   * Execute raw SQL. Returns typed array.
   */
  raw<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): T[] {
    return this.exec<T>(sql, params);
  }

  /**
   * Run a synchronous transaction.
   */
  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  // Internal helpers

  private buildSelect<C extends ColumnsRecord>(
    table: TableDef<C>,
    options?: SelectOptions,
  ): { sql: string; params: unknown[] } {
    const cols = Object.keys(table.columns)
      .map((k) => `"${k}"`)
      .join(", ");
    let sql = `SELECT ${cols} FROM "${table.name}"`;
    const params: unknown[] = [];

    if (options?.where) {
      const cond = options.where.toSql();
      sql += ` WHERE ${cond.sql}`;
      params.push(...cond.params);
    }

    if (options?.orderBy) {
      const dir = options.orderBy.direction === "desc" ? "DESC" : "ASC";
      sql += ` ORDER BY "${options.orderBy.column}" ${dir}`;
    }

    if (options?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    return { sql, params };
  }

  private buildInsert<C extends ColumnsRecord>(
    table: TableDef<C>,
    values: InferInsert<C>,
  ): { sql: string; params: unknown[] } {
    const entries = Object.entries(values as Record<string, unknown>);
    const cols = entries.map(([k]) => `"${k}"`).join(", ");
    const placeholders = entries.map(() => "?").join(", ");
    const params = entries.map(([, v]) => v);

    const sql = `INSERT INTO "${table.name}" (${cols}) VALUES (${placeholders})`;
    return { sql, params };
  }

  private exec<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[],
  ): T[] {
    const cursor =
      params.length > 0
        ? this.storage.sql.exec<T>(sql, ...params)
        : this.storage.sql.exec<T>(sql);
    return cursor.toArray();
  }
}

/**
 * Create a Database instance from DO storage.
 */
export function createDb(storage: DOStorage): Database {
  return new Database(storage);
}

/**
 * Ordering helpers.
 */
export function asc(column: string): { column: string; direction: OrderDirection } {
  return { column, direction: "asc" };
}

export function desc(column: string): { column: string; direction: OrderDirection } {
  return { column, direction: "desc" };
}
