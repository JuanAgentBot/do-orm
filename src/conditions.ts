/**
 * WHERE condition builders.
 *
 * Conditions produce SQL fragments with parameter bindings.
 */

export interface Condition {
  toSql(): { sql: string; params: unknown[] };
}

class CompareCondition implements Condition {
  constructor(
    private column: string,
    private op: string,
    private value: unknown,
  ) {}

  toSql() {
    return { sql: `"${this.column}" ${this.op} ?`, params: [this.value] };
  }
}

class AndCondition implements Condition {
  constructor(private conditions: Condition[]) {}

  toSql() {
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const c of this.conditions) {
      const result = c.toSql();
      parts.push(result.sql);
      params.push(...result.params);
    }
    return { sql: parts.map((p) => `(${p})`).join(" AND "), params };
  }
}

export function eq(column: string, value: unknown): Condition {
  return new CompareCondition(column, "=", value);
}

export function ne(column: string, value: unknown): Condition {
  return new CompareCondition(column, "!=", value);
}

export function lt(column: string, value: unknown): Condition {
  return new CompareCondition(column, "<", value);
}

export function lte(column: string, value: unknown): Condition {
  return new CompareCondition(column, "<=", value);
}

export function gt(column: string, value: unknown): Condition {
  return new CompareCondition(column, ">", value);
}

export function gte(column: string, value: unknown): Condition {
  return new CompareCondition(column, ">=", value);
}

export function and(...conditions: Condition[]): Condition {
  return new AndCondition(conditions);
}
