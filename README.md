# do-orm

Minimal type-safe ORM for Cloudflare Durable Object SQLite. ~250 lines. Zero dependencies.

Built as a lightweight replacement for [drizzle-orm](https://orm.drizzle.team/) in projects where the database is always an embedded SQLite inside a Durable Object. No driver abstraction, no query planner, no schema introspection. Just typed CRUD over `ctx.storage.sql.exec()`.

## Why

Drizzle is a great ORM for general-purpose apps. But Durable Objects have a specific context:

- The database is always SQLite, always local, always embedded
- There's no connection pooling, no network, no driver switching
- Most queries are simple CRUD by primary key
- The full drizzle-orm package is ~6MB for patterns that need ~250 lines

This library covers the query patterns actually used in DO-based apps: select, insert, update, delete, count, ordering, filtering, transactions. Nothing else.

## Install

```
npm install do-orm
```

## Usage

### Define tables

```typescript
import { table, column, ref } from 'do-orm';

const users = table('users', {
  id: column.integer().primaryKey().autoIncrement(),
  name: column.text().notNull(),
  email: column.text(),  // nullable by default
  role: column.text().notNull().default('user'),
});

const posts = table('posts', {
  id: column.integer().primaryKey().autoIncrement(),
  title: column.text().notNull(),
  authorId: column.integer().notNull().references(ref(users, 'id')),
  createdAt: column.text().notNull(),
});
```

### Type inference

```typescript
import type { InferRow, InferInsert } from 'do-orm';

type User = InferRow<typeof users['columns']>;
// { id: number; name: string; email: string | null; role: string }

type NewUser = InferInsert<typeof users['columns']>;
// { name: string } & { id?: number; email?: string | null; role?: string }
```

AutoIncrement PKs, nullable columns, and columns with defaults are optional in insert types.

### Query

```typescript
import { createDb, eq, ne, lt, lte, gt, gte, and, asc, desc } from 'do-orm';

// In your Durable Object constructor:
const db = createDb(ctx.storage);

// Select
db.all(users);                                       // all rows
db.all(users, { where: eq('role', 'admin') });       // filtered
db.all(users, { orderBy: desc('name'), limit: 10 }); // sorted + limited
db.get(users, { where: eq('id', 1) });               // one row or undefined

// Count
db.count(users, { where: eq('role', 'admin') });

// Insert
db.insert(users, { name: 'Alice', role: 'admin' });
const { id } = db.insertReturning(users, { name: 'Bob' }, ['id']);

// Update
db.update(users, { email: 'new@x.com' }, { where: eq('id', 1) });

// Delete
db.delete(users, { where: eq('id', 1) });

// Comparison operators
db.all(posts, { where: gt('id', 100) });                                    // greater than
db.all(posts, { where: gte('createdAt', '2026-01-01') });                   // greater than or equal
db.all(posts, { where: lt('id', cursor) });                                  // less than
db.all(users, { where: ne('role', 'banned') });                              // not equal

// Compound conditions
db.all(posts, { where: and(eq('authorId', 1), eq('status', 'published')) });

// Cursor pagination
db.all(posts, {
  where: and(lt('id', cursor), gte('createdAt', since)),
  orderBy: desc('id'),
  limit: 20,
});

// Transaction
db.transaction(() => {
  db.insert(users, { name: 'Alice' });
  db.insert(users, { name: 'Bob' });
});

// Raw SQL escape hatch
db.raw<{ count: number }>('SELECT COUNT(*) as count FROM users');
```

### In a Durable Object

```typescript
import { DurableObject } from 'cloudflare:workers';
import { createDb, migrate, createTableSql, eq, type Database } from 'do-orm';
import { users } from './schema';

const migrations = {
  m0000: createTableSql(users),
  m0001: `ALTER TABLE "users" ADD COLUMN "bio" TEXT`,
};

export class UserDO extends DurableObject {
  private db: Database;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    migrate(ctx.storage, migrations);
    this.db = createDb(ctx.storage);
  }

  async getUser(id: number) {
    return this.db.get(users, { where: eq('id', id) });
  }

  async createUser(name: string, email?: string) {
    return this.db.insertReturning(users, { name, email: email ?? null }, ['id']);
  }

  async listByRole(role: string) {
    return this.db.all(users, { where: eq('role', role) });
  }
}
```

## API

### Schema

| Function | Description |
|----------|-------------|
| `table(name, columns)` | Define a table with typed columns |
| `column.integer()` | Integer column builder |
| `column.text()` | Text column builder |
| `ref(table, column)` | FK reference helper |

Column modifiers: `.notNull()`, `.primaryKey()`, `.autoIncrement()`, `.unique()`, `.default(value)`, `.references(ref(...))`.

### Database

| Method | Description |
|--------|-------------|
| `createDb(storage)` | Create a Database from DO storage |
| `db.all(table, opts?)` | Select all matching rows |
| `db.get(table, opts?)` | Select one row or undefined |
| `db.count(table, opts?)` | Count matching rows |
| `db.insert(table, values)` | Insert a row |
| `db.insertReturning(table, values, cols)` | Insert and return columns |
| `db.update(table, values, opts?)` | Update matching rows |
| `db.delete(table, opts?)` | Delete matching rows |
| `db.transaction(fn)` | Run in transactionSync |
| `db.raw(sql, params?)` | Execute raw SQL |

### Conditions

| Function | Description |
|----------|-------------|
| `eq(column, value)` | Equal (`=`) |
| `ne(column, value)` | Not equal (`!=`) |
| `lt(column, value)` | Less than (`<`) |
| `lte(column, value)` | Less than or equal (`<=`) |
| `gt(column, value)` | Greater than (`>`) |
| `gte(column, value)` | Greater than or equal (`>=`) |
| `and(...conditions)` | AND multiple conditions |

### Ordering

| Function | Description |
|----------|-------------|
| `asc(column)` | Ascending order |
| `desc(column)` | Descending order |

### Migrations

| Function | Description |
|----------|-------------|
| `migrate(storage, migrations)` | Run pending migrations against DO storage |
| `createTableSql(table)` | Generate CREATE TABLE SQL from a table definition |
| `MigrationError` | Error class with version, statement, and cause context |

## Migrations

Built-in migration runner. Migrations are a record keyed by `mNNNN` (m0000, m0001, ...). Call `migrate()` in your DO constructor. Only unapplied migrations run. All new migrations execute in a single transaction.

```typescript
import { migrate, createTableSql } from 'do-orm';

const users = table('users', {
  id: column.integer().primaryKey().autoIncrement(),
  name: column.text().notNull(),
  email: column.text(),
});

// In your DO constructor:
migrate(ctx.storage, {
  // Migration 0: generate CREATE TABLE from schema
  m0000: createTableSql(users),
  // Migration 1: hand-written SQL for schema changes
  m0001: `ALTER TABLE "users" ADD COLUMN "role" TEXT DEFAULT 'user'`,
  // Migration 2: multi-statement (use --> statement-breakpoint separator)
  m0002: [
    'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL)',
    '--> statement-breakpoint',
    'CREATE INDEX idx_posts_title ON posts (title)',
  ].join('\n'),
});
```

Migrations are tracked by version in a `__migrations` table. Keys must be sequential starting from m0000.

### Importing .sql files

For projects with many migrations, import SQL files directly:

```typescript
import m0000 from './migrations/0000_initial.sql';
import m0001 from './migrations/0001_add_users.sql';
migrate(storage, { m0000, m0001 });
```

### Drizzle adoption

If you're migrating from Drizzle, the runner automatically detects a `__drizzle_migrations` table and adopts existing migrations. Just include all your existing migration SQL strings in the record. The Drizzle tracking table is dropped after adoption.

`createTableSql()` generates `CREATE TABLE IF NOT EXISTS` from a table definition, so you define the schema once and get both type-safe queries and the initial migration.

## License

MIT
