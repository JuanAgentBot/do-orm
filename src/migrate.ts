/**
 * SQLite migration runner for Cloudflare Durable Objects.
 *
 * Sequential SQL migrations identified by mNNNN keys (m0000, m0001, ...).
 * Applied inside a single transaction. Built-in one-time adoption from
 * Drizzle's __drizzle_migrations table.
 *
 * Usage with .sql file imports:
 * ```ts
 * import m0000 from './migrations/0000_initial.sql';
 * import m0001 from './migrations/0001_add_users.sql';
 * migrate(storage, { m0000, m0001 });
 * ```
 *
 * Usage with inline SQL:
 * ```ts
 * migrate(storage, {
 *   m0000: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
 *   m0001: 'ALTER TABLE users ADD COLUMN email TEXT',
 * });
 * ```
 */

import type { DOStorage } from "./db.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class MigrationError extends Error {
  readonly version: number;
  readonly statement: string;
  readonly cause: unknown;

  constructor(opts: {
    version: number;
    statement: string;
    cause: unknown;
    appliedBefore: number;
  }) {
    const trimmed = opts.statement.trim();
    const preview =
      trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
    super(
      `Migration ${opts.version} failed\n` +
        `  Statement: ${preview}\n` +
        `  Error: ${opts.cause instanceof Error ? opts.cause.message : String(opts.cause)}\n` +
        `  State: ${opts.appliedBefore} migration(s) were applied before this attempt`,
    );
    this.name = "MigrationError";
    this.version = opts.version;
    this.statement = trimmed;
    this.cause = opts.cause;
  }
}

// ---------------------------------------------------------------------------
// migrate()
// ---------------------------------------------------------------------------

/**
 * Run migrations against a Durable Object's SQLite storage.
 *
 * `migrations` is a record keyed by `mNNNN` (e.g. `m0000`, `m0001`) where
 * each value is the SQL string for that migration. Keys map to version numbers:
 * `m0000` → version 0, `m0042` → version 42.
 *
 * Multi-statement migrations use `--> statement-breakpoint` as a separator.
 */
export function migrate(
  storage: DOStorage,
  migrations: Record<string, string>,
): void {
  const parsed = parseMigrations(migrations);

  if (parsed.length === 0) {
    storage.transactionSync(() => {
      createTrackingTable(storage);
    });
    return;
  }

  storage.transactionSync(() => {
    createTrackingTable(storage);
    adoptDrizzle(storage, parsed.length);

    const maxVersion = getMaxVersion(storage);
    const pending = parsed.filter((m) => m.version > maxVersion);

    for (const migration of pending) {
      const statements = migration.sql.split("--> statement-breakpoint");
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;
        try {
          storage.sql.exec(trimmed);
        } catch (cause) {
          throw new MigrationError({
            version: migration.version,
            statement: trimmed,
            cause,
            appliedBefore: maxVersion + 1,
          });
        }
      }
      storage.sql.exec(
        "INSERT INTO __migrations (version) VALUES (?)",
        migration.version,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParsedMigration {
  version: number;
  sql: string;
}

function parseMigrations(
  migrations: Record<string, string>,
): ParsedMigration[] {
  const keys = Object.keys(migrations);
  if (keys.length === 0) return [];

  const parsed: ParsedMigration[] = [];
  for (const key of keys) {
    const match = key.match(/^m(\d{4})$/);
    if (!match) {
      throw new Error(
        `Invalid migration key "${key}": must be "m" followed by exactly 4 digits (e.g. "m0000")`,
      );
    }
    const version = parseInt(match[1], 10);
    parsed.push({ version, sql: migrations[key] });
  }

  parsed.sort((a, b) => a.version - b.version);

  // Validate sequential
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].version !== i) {
      throw new Error(
        `Migrations must be sequential: expected version ${i}, got ${parsed[i].version} (m${parsed[i].version.toString().padStart(4, "0")})`,
      );
    }
  }

  return parsed;
}

function createTrackingTable(storage: DOStorage): void {
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS __migrations (version INTEGER PRIMARY KEY)",
  );
}

function adoptDrizzle(storage: DOStorage, totalMigrations: number): void {
  // Check if Drizzle tracking table exists
  const tables = storage.sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .toArray();

  if (tables.length === 0) return;

  // Check if we already adopted (idempotent)
  const existing = storage.sql
    .exec<{ count: number }>("SELECT COUNT(*) as count FROM __migrations")
    .one();

  if (existing.count > 0) return;

  // Count Drizzle migrations
  const drizzle = storage.sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) as count FROM __drizzle_migrations",
    )
    .one();

  const drizzleCount = drizzle.count;
  if (drizzleCount > totalMigrations) {
    throw new Error(
      `Drizzle has ${drizzleCount} migrations but only ${totalMigrations} were provided. ` +
        "All existing Drizzle migrations must be included.",
    );
  }

  // Mark versions 0..(drizzleCount-1) as already applied
  for (let v = 0; v < drizzleCount; v++) {
    storage.sql.exec(
      "INSERT INTO __migrations (version) VALUES (?)",
      v,
    );
  }

  // Drop Drizzle tracking table
  storage.sql.exec("DROP TABLE __drizzle_migrations");
}

function getMaxVersion(storage: DOStorage): number {
  const row = storage.sql
    .exec<{ maxV: number | null }>(
      "SELECT MAX(version) as maxV FROM __migrations",
    )
    .one();
  return row.maxV ?? -1;
}
