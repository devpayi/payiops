export type SqlValue = string | number | boolean | null | Date | Buffer | readonly string[];
const statements = new WeakSet<object>();
export interface Statement {
  readonly text: string;
  readonly values: readonly SqlValue[];
}

/** All interpolations become bind parameters; no raw SQL/string interpolation API. */
export function sql(strings: TemplateStringsArray, ...values: SqlValue[]): Statement {
  const text = strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  // This is a guardrail for trusted repository code, not a general SQL sandbox.
  // Transaction/session control is exclusively owned by TenantDatabase.
  if (!/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(text) ||
      /;|--|\/\*|\b(set_config|dblink|pg_read_file|pg_write_file)\b/i.test(text)) {
    throw new Error('Only a single parameterized data statement is allowed');
  }
  const statement = Object.freeze({ text, values: Object.freeze(values) });
  statements.add(statement);
  return statement;
}
export function assertStatement(value: Statement): void {
  if (!statements.has(value)) throw new Error('Statement must be created with the sql template tag');
}
