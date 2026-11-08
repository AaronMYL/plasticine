// pi 在执行工具前已经按参数 schema 校验过（validateToolArguments），但 pi-schema 推不出 TypeBox 的枚举这类类型。
// 这里再用同一份 TypeBox schema 核一次，拿到准确的类型；核不过就报错（工具报错原样交回模型）。

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
