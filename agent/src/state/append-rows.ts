// 只追加的小表（触发、去向、规则事件、凭什么做、订阅、送到事的输入）共用的读写：写之前按 schema 校验、
// 读出来再校验一次；SQL 的 where / order 只由 state/ 里的文件写，不收调用方的文字。

import type { Static, TSchema } from 'typebox';
import { checked, decodeRow, encodeRow, normalizeTimes, sqlColumns, type ColumnMap } from './codec.ts';
import type { Params } from './db.ts';
import { fromSqliteError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface AppendRows<T extends TSchema> {
  insert(row: Static<T>): Static<T>;
  /** `where` 是 state/ 里写死的 SQL。 */
  select(where: string, params?: Params, order?: string, limit?: number): Static<T>[];
  count(where: string, params?: Params): number;
}

export function appendRows<T extends TSchema>(context: StoreContext, table: string, schema: T,
  columns: ColumnMap): AppendRows<T> {
  const { names, placeholders } = sqlColumns(columns);
  const insertSql = `INSERT INTO ${table} (${names}) VALUES (${placeholders})`;
  const typed = (values: unknown): Static<T> => checked(schema, values, 'corrupt_record', `${table} 里的一行不符合 schema`);
  return {
    insert(row) {
      const values = normalizeTimes(schema, checked(schema, row, 'invalid_input', `写 ${table}`) as
        Readonly<Record<string, unknown>>);
      try {
        context.db.run(insertSql, encodeRow(columns, values));
      } catch (error) {
        throw fromSqliteError(error, `写 ${table}`);
      }
      return typed(values);
    },
    select(where, params = {}, order = 'rowid', limit = 500) {
      const sql = `SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT $limit`;
      return context.db.all(sql, { ...params, limit }).map((raw) => typed(decodeRow(columns, raw)));
    },
    count(where, params = {}) {
      return Number(context.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params)?.['n'] ?? 0);
    },
  };
}
