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
import { createDb, eq, and, asc, desc } from 'do-orm';

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

// Compound conditions
db.all(posts, { where: and(eq('authorId', 1), eq('status', 'published')) });

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
import { createDb, eq, type Database } from 'do-orm';
import { users } from './schema';

export class UserDO extends DurableObject {
  private db: Database;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
| `eq(column, value)` | Equality condition |
| `and(...conditions)` | AND multiple conditions |

### Ordering

| Function | Description |
|----------|-------------|
| `asc(column)` | Ascending order |
| `desc(column)` | Descending order |

## Migrations

This library doesn't handle migrations. Write them as SQL files and run them with `ctx.storage.sql.exec()` in your DO constructor, or use a migration runner like the one in this [Cloudflare monorepo template](https://github.com/JuanAgentBot/cf-monorepo-template).

## License

MIT
