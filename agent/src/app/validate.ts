// External input is checked against its shared schema before use (plasticine-code「外部输入先过 schema」); a
// failure is a 400 naming the field.

import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { ApiError } from './api-error.ts';

function fieldOf(schema: TSchema, instancePath: string, missing: unknown): string {
  const root = instancePath.split('/')[1] ?? '';
  const properties: unknown = 'properties' in schema ? schema.properties : undefined;
  // 未知属性名属于请求内容，不能在错误消息或 field 中回显；仅引用 schema 声明过的顶层字段。
  if (typeof properties !== 'object' || properties === null) {
    return '';
  }
  const candidates: unknown[] = [root, ...(Array.isArray(missing) ? missing : [])];
  return candidates.find(
    (field): field is string => typeof field === 'string' && Object.hasOwn(properties, field),
  ) ?? '';
}

export function checkInput<T extends TSchema>(schema: T, value: unknown, where: string): Static<T> {
  if (Value.Check(schema, value)) {
    return value;
  }
  const first = Value.Errors(schema, value)[0];
  const params = first?.params;
  const missing = params !== undefined && 'requiredProperties' in params ? params.requiredProperties : undefined;
  const field = first === undefined ? '' : fieldOf(schema, first.instancePath, missing);
  const what = field === '' ? where : `${where}的 ${field}`;
  const details = field === '' ? {} : { field };
  throw new ApiError(400, 'invalid_request', `${what}不合要求。请检查字段格式后再试。`, details);
}

/**
 * Query values arrive as text. Whole numbers and true / false are converted for the keys listed, so the shared
 * schema checks the real types; anything else stays text and fails the schema with the key named.
 */
export function queryObject(
  params: URLSearchParams,
  types: Readonly<Record<string, 'integer' | 'boolean'>> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of params) {
    const type = types[key];
    if (type === 'integer' && /^-?\d+$/.test(raw)) {
      result[key] = Number(raw);
    } else if (type === 'boolean' && (raw === 'true' || raw === 'false')) {
      result[key] = raw === 'true';
    } else {
      result[key] = raw;
    }
  }
  return result;
}
