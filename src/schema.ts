/**
 * Schema definition for DO SQLite tables.
 *
 * Tables are defined as plain objects with column metadata.
 * TypeScript infers row types from the definitions.
 */

// Column types that map to SQLite types
type SqliteType = "integer" | "text";

// Column definition with metadata
export interface ColumnDef<T extends SqliteType, Nullable extends boolean> {
  readonly type: T;
  readonly nullable: Nullable;
  readonly primaryKey: boolean;
  readonly autoIncrement: boolean;
  readonly unique: boolean;
  readonly defaultValue: unknown;
  readonly references: (() => ColumnRef) | undefined;
}

interface ColumnRef {
  table: string;
  column: string;
}

// Map SQLite types to TypeScript types
type SqliteToTs<T extends SqliteType> = T extends "integer"
  ? number
  : T extends "text"
    ? string
    : never;

// Resolve nullability
type ColumnTsType<C extends ColumnDef<SqliteType, boolean>> =
  C["nullable"] extends true
    ? SqliteToTs<C["type"]> | null
    : SqliteToTs<C["type"]>;

// Infer the row type from a columns definition
export type ColumnsRecord = Record<string, ColumnDef<SqliteType, boolean>>;

export type InferRow<T extends ColumnsRecord> = {
  [K in keyof T]: ColumnTsType<T[K]>;
};

// Infer the insert type (omit autoIncrement PKs, make nullable/default fields optional)
type OptionalInsertKeys<T extends ColumnsRecord> = {
  [K in keyof T]: T[K]["autoIncrement"] extends true
    ? K
    : T[K]["nullable"] extends true
      ? K
      : T[K]["defaultValue"] extends undefined
        ? never
        : K;
}[keyof T];

type RequiredInsertKeys<T extends ColumnsRecord> = Exclude<
  keyof T,
  OptionalInsertKeys<T>
>;

export type InferInsert<T extends ColumnsRecord> = {
  [K in RequiredInsertKeys<T>]: ColumnTsType<T[K]>;
} & {
  [K in OptionalInsertKeys<T>]?: ColumnTsType<T[K]>;
};

// Table definition
export interface TableDef<C extends ColumnsRecord = ColumnsRecord> {
  readonly name: string;
  readonly columns: C;
}

// Column builders - generic parameter tracks nullability at the type level

class IntegerColumnBuilder<
  Nullable extends boolean = true,
  AutoInc extends boolean = false,
  HasDefault extends boolean = false,
> {
  private _nullable: boolean = true;
  private _primaryKey = false;
  private _autoIncrement = false;
  private _unique = false;
  private _defaultValue: unknown = undefined;
  private _references: (() => ColumnRef) | undefined = undefined;

  notNull(): IntegerColumnBuilder<false, AutoInc, HasDefault> {
    this._nullable = false;
    return this as unknown as IntegerColumnBuilder<false, AutoInc, HasDefault>;
  }

  primaryKey(): IntegerColumnBuilder<Nullable, AutoInc, HasDefault> {
    this._primaryKey = true;
    return this;
  }

  autoIncrement(): IntegerColumnBuilder<Nullable, true, HasDefault> {
    this._autoIncrement = true;
    return this as unknown as IntegerColumnBuilder<Nullable, true, HasDefault>;
  }

  unique(): IntegerColumnBuilder<Nullable, AutoInc, HasDefault> {
    this._unique = true;
    return this;
  }

  default(_value: number): IntegerColumnBuilder<Nullable, AutoInc, true> {
    this._defaultValue = _value;
    return this as unknown as IntegerColumnBuilder<Nullable, AutoInc, true>;
  }

  references(ref: () => ColumnRef): IntegerColumnBuilder<Nullable, AutoInc, HasDefault> {
    this._references = ref;
    return this;
  }

  /** @internal */
  _build(): ColumnDef<"integer", Nullable> & { autoIncrement: AutoInc; defaultValue: HasDefault extends true ? number : undefined } {
    return {
      type: "integer",
      nullable: this._nullable as Nullable,
      primaryKey: this._primaryKey,
      autoIncrement: this._autoIncrement,
      unique: this._unique,
      defaultValue: this._defaultValue,
      references: this._references,
    } as ColumnDef<"integer", Nullable> & { autoIncrement: AutoInc; defaultValue: HasDefault extends true ? number : undefined };
  }
}

class TextColumnBuilder<
  Nullable extends boolean = true,
  HasDefault extends boolean = false,
> {
  private _nullable: boolean = true;
  private _primaryKey = false;
  private _unique = false;
  private _defaultValue: unknown = undefined;
  private _references: (() => ColumnRef) | undefined = undefined;

  notNull(): TextColumnBuilder<false, HasDefault> {
    this._nullable = false;
    return this as unknown as TextColumnBuilder<false, HasDefault>;
  }

  primaryKey(): TextColumnBuilder<Nullable, HasDefault> {
    this._primaryKey = true;
    return this;
  }

  unique(): TextColumnBuilder<Nullable, HasDefault> {
    this._unique = true;
    return this;
  }

  default(_value: string): TextColumnBuilder<Nullable, true> {
    this._defaultValue = _value;
    return this as unknown as TextColumnBuilder<Nullable, true>;
  }

  references(ref: () => ColumnRef): TextColumnBuilder<Nullable, HasDefault> {
    this._references = ref;
    return this;
  }

  /** @internal */
  _build(): ColumnDef<"text", Nullable> & { defaultValue: HasDefault extends true ? string : undefined } {
    return {
      type: "text",
      nullable: this._nullable as Nullable,
      primaryKey: this._primaryKey,
      autoIncrement: false,
      unique: this._unique,
      defaultValue: this._defaultValue,
      references: this._references,
    } as ColumnDef<"text", Nullable> & { defaultValue: HasDefault extends true ? string : undefined };
  }
}

// Public API for defining columns
export const column = {
  integer(): IntegerColumnBuilder {
    return new IntegerColumnBuilder();
  },
  text(): TextColumnBuilder {
    return new TextColumnBuilder();
  },
};

// Infer the ColumnsRecord from builders
type AnyColumnBuilder = IntegerColumnBuilder<boolean, boolean, boolean> | TextColumnBuilder<boolean, boolean>;
type ColumnBuilders = Record<string, AnyColumnBuilder>;

type InferColumns<B extends ColumnBuilders> = {
  [K in keyof B]: B[K] extends { _build(): infer R extends ColumnDef<SqliteType, boolean> } ? R : never;
};

export function table<B extends ColumnBuilders>(
  name: string,
  builders: B,
): TableDef<InferColumns<B>> {
  const columns: Record<string, ColumnDef<SqliteType, boolean>> = {};
  for (const [key, builder] of Object.entries(builders)) {
    columns[key] = (builder as AnyColumnBuilder)._build();
  }
  return { name, columns: columns as InferColumns<B> };
}

// Helper for FK references
export function ref(
  tableDef: TableDef,
  columnName: string,
): () => ColumnRef {
  return () => ({ table: tableDef.name, column: columnName });
}
