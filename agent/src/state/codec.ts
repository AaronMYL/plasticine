// Converts between the camelCase objects of shared/state.ts and snake_case SQLite rows, and validates both ways:
// what comes in is checked against its schema before it is written, what comes out is checked before it is
// returned, so a hand-edited or corrupted row surfaces as an error instead of a wrongly typed object.

import type { SQLInputValue } from 'node:sqlite';
import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { validationField } from '../shared-validation.ts';
import type { Params, Row } from './db.ts';
import { StateError, type StateErrorCode } from './errors.ts';

export type ColumnKind = 'text' | 'integer' | 'real' | 'boolean' | 'json';
export type ColumnMap = Readonly<Record<string, ColumnKind>>;

// Column maps for the meta columns of shared/state-common.ts (RECORD_META, MIGRATION_META, CONFIRMATION_META).
export const RECORD_META_COLUMNS: ColumnMap = { id: 'text', createdAt: 'text', updatedAt: 'text', version: 'integer' };
export const OBJECT_META_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  migratedDefault: 'boolean',
  legacyPayload: 'json',
};
export const CONFIRMATION_META_COLUMNS: ColumnMap = { confirmedByDeviceId: 'text', confirmedByDeviceAt: 'text' };

export function columnName(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Returns `value` typed by `schema`, or throws `code` naming the first field that failed. */
export function checked<T extends TSchema>(
  schema: T,
  value: unknown,
  code: StateErrorCode,
  context: string,
): Static<T> {
  if (Value.Check(schema, value)) {
    return value;
  }
  const first = Value.Errors(schema, value)[0];
  if (first === undefined) {
    throw new StateError(code, `${context}：格式不对`);
  }
  const field = validationField(schema, first);
  return fail(code, `${context}：${field === '' ? '格式不对' : `${field} 格式不对`}`, field);
}

function fail(code: StateErrorCode, message: string, field: string): never {
  throw new StateError(code, message, field === '' ? {} : { field });
}

export function encodeValue(kind: ColumnKind, value: unknown, field: string): SQLInputValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (kind === 'json') {
    return JSON.stringify(value);
  }
  if (kind === 'boolean' && typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (kind === 'text' && typeof value === 'string') {
    return value;
  }
  if ((kind === 'integer' || kind === 'real') && typeof value === 'number') {
    return value;
  }
  return fail('invalid_input', `${field} 的值和列类型 ${kind} 对不上`, field);
}

/** Named parameters for every field in `columns`; a field absent from `values` is bound as NULL. */
export function encodeRow(columns: ColumnMap, values: Readonly<Record<string, unknown>>): Params {
  const params: Params = {};
  for (const [field, kind] of Object.entries(columns)) {
    params[columnName(field)] = encodeValue(kind, values[field], field);
  }
  return params;
}

function decodeValue(kind: ColumnKind, raw: unknown, field: string): unknown {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (kind === 'boolean') {
    return raw === 1;
  }
  if (kind !== 'json') {
    return raw;
  }
  try {
    return JSON.parse(String(raw));
  } catch (error) {
    throw new StateError('corrupt_record', `${field} 列里存的不是合法 JSON`, { field, cause: error });
  }
}

export function decodeRow(columns: ColumnMap, row: Row): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(columns)) {
    values[field] = decodeValue(kind, row[columnName(field)], field);
  }
  return values;
}

/** Decodes and validates one row; `table` only names the row in the error. */
export function readRow<T extends TSchema>(schema: T, columns: ColumnMap, row: Row, table: string): Static<T> {
  return checked(schema, decodeRow(columns, row), 'corrupt_record', `${table} 里的一行不符合 schema`);
}

function isTimeSchema(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) {
    return false;
  }
  if ('format' in schema && schema.format === 'date-time') {
    return true;
  }
  return 'anyOf' in schema && Array.isArray(schema.anyOf) && schema.anyOf.some(isTimeSchema);
}

/**
 * Top-level date-time fields of `values` rewritten as UTC with millisecond precision (review-followups ad5667d:
 * the schema accepts any offset and any number of decimals, but times are compared and ordered as text). Call after
 * the schema check, so every value here already parses.
 */
export function normalizeTimes(schema: TSchema, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const properties: unknown = 'properties' in schema ? schema.properties : undefined;
  const result: Record<string, unknown> = { ...values };
  if (typeof properties !== 'object' || properties === null) {
    return result;
  }
  const fields = properties as Readonly<Record<string, unknown>>;
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || !isTimeSchema(fields[key])) {
      continue;
    }
    const at = Date.parse(value);
    if (!Number.isNaN(at)) {
      result[key] = new Date(at).toISOString();
    }
  }
  return result;
}

/** Drops keys whose value is `undefined`, so "absent" and "explicitly undefined" mean the same thing. */
export function definedEntries(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export function sqlColumns(columns: ColumnMap): { names: string; placeholders: string } {
  const names = Object.keys(columns).map(columnName);
  return { names: names.join(', '), placeholders: names.map((name) => `$${name}`).join(', ') };
}
