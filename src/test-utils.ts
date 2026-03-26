/**
 * In-memory mock of Cloudflare's DOStorage.sql interface.
 *
 * Uses a simple Map-based storage for testing.
 * Not a real SQLite engine, but enough to verify SQL generation and type inference.
 */

import type { DOStorage, SqlStorage } from "./db.js";

interface MockRow {
  [key: string]: unknown;
}

/**
 * Tracks all SQL statements executed against this mock.
 * Each entry is { sql, params, results }.
 */
export interface ExecutedStatement {
  sql: string;
  params: unknown[];
}

/**
 * A mock DOStorage that records executed SQL and returns configured results.
 * Tests can inspect `statements` to verify generated SQL and parameters.
 */
export function createMockStorage(): DOStorage & {
  statements: ExecutedStatement[];
  tables: Map<string, MockRow[]>;
} {
  const statements: ExecutedStatement[] = [];
  const tables = new Map<string, MockRow[]>();

  // Simple SQL parser for the subset we generate
  function exec<T extends Record<string, unknown>>(
    sql: string,
    ...bindings: unknown[]
  ) {
    statements.push({ sql, params: [...bindings] });

    const trimmed = sql.trim();
    let results: MockRow[] = [];

    if (trimmed.startsWith("CREATE TABLE")) {
      const match = trimmed.match(/CREATE TABLE (?:IF NOT EXISTS )?"(\w+)"/);
      if (match) {
        if (!tables.has(match[1])) {
          tables.set(match[1], []);
        }
      }
    } else if (trimmed.startsWith("INSERT INTO")) {
      results = handleInsert(trimmed, bindings, tables);
    } else if (trimmed.startsWith("SELECT")) {
      results = handleSelect(trimmed, bindings, tables);
    } else if (trimmed.startsWith("UPDATE")) {
      handleUpdate(trimmed, bindings, tables);
    } else if (trimmed.startsWith("DELETE")) {
      handleDelete(trimmed, bindings, tables);
    }

    return {
      toArray: () => results as T[],
      one: () => results[0] as T,
      [Symbol.iterator]: function* () {
        yield* results as T[];
      },
    };
  }

  return {
    statements,
    tables,
    sql: { exec } as unknown as SqlStorage,
    transactionSync<T>(fn: () => T): T {
      return fn();
    },
  };
}

function handleInsert(
  sql: string,
  bindings: unknown[],
  tables: Map<string, MockRow[]>,
): MockRow[] {
  const tableMatch = sql.match(/INSERT INTO "(\w+)"/);
  if (!tableMatch) return [];
  const tableName = tableMatch[1];

  const colsMatch = sql.match(/\(([^)]+)\) VALUES/);
  if (!colsMatch) return [];
  const cols = colsMatch[1].split(",").map((c) => c.trim().replace(/"/g, ""));

  const row: MockRow = {};
  const rows = tables.get(tableName) ?? [];

  // Auto-increment: find max id and add 1
  let nextId = 1;
  for (const existing of rows) {
    if (typeof existing.id === "number" && existing.id >= nextId) {
      nextId = existing.id + 1;
    }
  }

  for (let i = 0; i < cols.length; i++) {
    row[cols[i]] = bindings[i] ?? null;
  }

  // If id not provided but table has rows, auto-assign
  if (row.id === undefined || row.id === null) {
    row.id = nextId;
  }

  rows.push(row);
  tables.set(tableName, rows);

  // Handle RETURNING clause
  if (sql.includes("RETURNING")) {
    const retMatch = sql.match(/RETURNING (.+)$/);
    if (retMatch) {
      const retCols = retMatch[1].split(",").map((c) => c.trim().replace(/"/g, ""));
      const result: MockRow = {};
      for (const col of retCols) {
        result[col] = row[col];
      }
      return [result];
    }
  }

  return [];
}

function handleSelect(
  sql: string,
  bindings: unknown[],
  tables: Map<string, MockRow[]>,
): MockRow[] {
  // COUNT query
  if (sql.includes("COUNT(*)")) {
    const tableMatch = sql.match(/FROM "(\w+)"/);
    if (!tableMatch) return [{ count: 0 }];
    const rows = tables.get(tableMatch[1]) ?? [];
    const filtered = applyWhere(rows, sql, bindings);
    return [{ count: filtered.length }];
  }

  const tableMatch = sql.match(/FROM "(\w+)"/);
  if (!tableMatch) return [];
  const tableName = tableMatch[1];
  const rows = tables.get(tableName) ?? [];

  // Parse selected columns
  const colsPart = sql.match(/SELECT (.+?) FROM/)?.[1] ?? "*";
  const selectedCols =
    colsPart === "*"
      ? null
      : colsPart.split(",").map((c) => c.trim().replace(/"/g, ""));

  let filtered = applyWhere(rows, sql, bindings);

  // ORDER BY
  const orderMatch = sql.match(/ORDER BY "(\w+)" (ASC|DESC)/);
  if (orderMatch) {
    const col = orderMatch[1];
    const dir = orderMatch[2];
    filtered = [...filtered].sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = va < vb ? -1 : 1;
      return dir === "DESC" ? -cmp : cmp;
    });
  }

  // LIMIT
  const limitMatch = sql.match(/LIMIT \?/);
  if (limitMatch) {
    // Find the limit param (last binding after WHERE params)
    const whereParamCount = (sql.match(/WHERE/)?.[0]
      ? (sql.match(/\? (?=.*LIMIT)/g)?.length ?? 0) +
        (sql.match(/= \?/g)?.length ?? 0) -
        (sql.match(/LIMIT \?/g)?.length ?? 0)
      : 0);
    const limitValue = bindings[whereParamCount] as number;
    filtered = filtered.slice(0, limitValue);
  }

  // Project columns
  if (selectedCols) {
    return filtered.map((row) => {
      const result: MockRow = {};
      for (const col of selectedCols) {
        result[col] = row[col] ?? null;
      }
      return result;
    });
  }

  return filtered;
}

function handleUpdate(
  sql: string,
  bindings: unknown[],
  tables: Map<string, MockRow[]>,
): void {
  const tableMatch = sql.match(/UPDATE "(\w+)"/);
  if (!tableMatch) return;
  const tableName = tableMatch[1];
  const rows = tables.get(tableName) ?? [];

  // Parse SET clause columns
  const setMatch = sql.match(/SET (.+?)(?:\s+WHERE|$)/);
  if (!setMatch) return;
  const setCols = setMatch[1]
    .split(",")
    .map((c) => c.trim().match(/"(\w+)"/)?.[1])
    .filter(Boolean) as string[];

  const setBindings = bindings.slice(0, setCols.length);
  const whereBindings = bindings.slice(setCols.length);

  const filtered = sql.includes("WHERE")
    ? applyWhere(rows, sql, whereBindings)
    : rows;

  for (const row of filtered) {
    for (let i = 0; i < setCols.length; i++) {
      row[setCols[i]] = setBindings[i];
    }
  }
}

function handleDelete(
  sql: string,
  bindings: unknown[],
  tables: Map<string, MockRow[]>,
): void {
  const tableMatch = sql.match(/DELETE FROM "(\w+)"/);
  if (!tableMatch) return;
  const tableName = tableMatch[1];
  const rows = tables.get(tableName) ?? [];

  if (!sql.includes("WHERE")) {
    tables.set(tableName, []);
    return;
  }

  const toKeep = rows.filter((row) => {
    return !matchesWhere(row, sql, bindings);
  });
  tables.set(tableName, toKeep);
}

function applyWhere(
  rows: MockRow[],
  sql: string,
  bindings: unknown[],
  bindingOffset = 0,
): MockRow[] {
  if (!sql.includes("WHERE")) return [...rows];

  return rows.filter((row) => matchesWhere(row, sql, bindings, bindingOffset));
}

function matchesWhere(
  row: MockRow,
  sql: string,
  bindings: unknown[],
  bindingOffset = 0,
): boolean {
  // Extract WHERE clause
  const whereMatch = sql.match(/WHERE (.+?)(?:\s+ORDER|\s+LIMIT|$)/);
  if (!whereMatch) return true;

  const whereSql = whereMatch[1];

  // Parse conditions: "col" op ? patterns (=, !=, <, <=, >, >=)
  const condMatches = [...whereSql.matchAll(/"(\w+)" (=|!=|<=|>=|<|>) \?/g)];
  let paramIdx = bindingOffset;
  for (const match of condMatches) {
    const col = match[1];
    const op = match[2];
    const val = bindings[paramIdx++];
    const rowVal = row[col];

    switch (op) {
      case "=":
        if (rowVal !== val) return false;
        break;
      case "!=":
        if (rowVal === val) return false;
        break;
      case "<":
        if (!(rowVal !== null && rowVal !== undefined && val !== null && val !== undefined && rowVal < val)) return false;
        break;
      case "<=":
        if (!(rowVal !== null && rowVal !== undefined && val !== null && val !== undefined && rowVal <= val)) return false;
        break;
      case ">":
        if (!(rowVal !== null && rowVal !== undefined && val !== null && val !== undefined && rowVal > val)) return false;
        break;
      case ">=":
        if (!(rowVal !== null && rowVal !== undefined && val !== null && val !== undefined && rowVal >= val)) return false;
        break;
    }
  }

  return true;
}
