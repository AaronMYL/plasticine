import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

export function checkedArgs<T extends TSchema>(schema: T, params: unknown, tool: string): Static<T> {
  if (Value.Check(schema, params)) {
    return params;
  }
  const first = Value.Errors(schema, params)[0];
  const where = first === undefined ? '' : `（${first.instancePath || '/'} ${first.message}）`;
  throw new Error(`「${tool}」的参数不合要求${where}，这次没有执行。`);
}
