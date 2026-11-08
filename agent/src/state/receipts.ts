// 回执（《实施方案》第 7 节「回执幂等」, harness 5.2 第 4 步）：action_id 是主键，同一动作只有一行。
// `issue` 在执行之前落盘；已有这一行就原样返回、不新建，调用方据它的状态决定复用、核实还是执行。
// 能不能重放、未知怎么核实是 execution/receipts.ts 的事，这里只存取。

import {
  ReceiptInputSchema,
  ReceiptPatchSchema,
  ReceiptSchema,
  type Receipt,
  type ReceiptInput,
  type ReceiptPatch,
} from '../../shared/state.ts';
import { checked, columnName, definedEntries, encodeRow, readRow, sqlColumns, type ColumnMap } from './codec.ts';
import type { Params } from './db.ts';
import { fromSqliteError, notFound, versionConflict } from './errors.ts';
import { allPages, MAX_PAGE_SIZE, type StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  actionId: 'text',
  createdAt: 'text',
  updatedAt: 'text',
  version: 'integer',
  taskId: 'text',
  stepKey: 'text',
  attempt: 'integer',
  runId: 'text',
  tool: 'text',
  argsDigest: 'text',
  replay: 'text',
  effect: 'text',
  status: 'text',
  resultRef: 'text',
  receivedAt: 'text',
  deliveredAt: 'text',
  executedAt: 'text',
  verifiedAt: 'text',
};
const INSERT_SQL = (() => {
  const { names, placeholders } = sqlColumns(COLUMNS);
  return `INSERT INTO receipts (${names}) VALUES (${placeholders})`;
})();

export interface IssuedReceipt {
  receipt: Receipt;
  /** False when the action id already had a receipt: the action must not simply run again. */
  created: boolean;
}

export function createReceiptStore(context: StoreContext) {
  function get(actionId: string): Receipt | undefined {
    const row = context.db.get('SELECT * FROM receipts WHERE action_id = $action_id', { action_id: actionId });
    return row === undefined ? undefined : readRow(ReceiptSchema, COLUMNS, row, 'receipts');
  }

  /** Every matching receipt, page by page (a fixed first page silently skipped the rest at start-up). */
  function select(where: string, params: Params): Receipt[] {
    const sql = `SELECT * FROM receipts WHERE ${where} ORDER BY created_at, action_id LIMIT $limit OFFSET $offset`;
    return allPages((page) => {
      const rows = context.db.all(sql, { ...params, limit: page.limit ?? MAX_PAGE_SIZE, offset: page.offset ?? 0 });
      return rows.map((row) => readRow(ReceiptSchema, COLUMNS, row, 'receipts'));
    });
  }

  function issue(input: ReceiptInput): IssuedReceipt {
    const values = checked(ReceiptInputSchema, input, 'invalid_input', '签发回执');
    return context.db.transaction(() => {
      const existing = get(values.actionId);
      if (existing !== undefined) {
        return { receipt: existing, created: false };
      }
      const now = context.now();
      const draft = {
        ...Object.fromEntries(Object.keys(COLUMNS).map((field) => [field, null])),
        ...values,
        status: 'issued',
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      const receipt = checked(ReceiptSchema, draft, 'invalid_input', '签发回执');
      try {
        context.db.run(INSERT_SQL, encodeRow(COLUMNS, draft));
      } catch (error) {
        throw fromSqliteError(error, '签发回执');
      }
      return { receipt, created: true };
    });
  }

  function update(actionId: string, expectedVersion: number, patch: ReceiptPatch): Receipt {
    const values = definedEntries(checked(ReceiptPatchSchema, patch, 'invalid_input', '更新回执'));
    return context.db.transaction(() => {
      const current = get(actionId);
      if (current === undefined) {
        throw notFound('receipts', actionId);
      }
      if (current.version !== expectedVersion) {
        throw versionConflict('receipts', actionId, expectedVersion, current.version);
      }
      const next = checked(
        ReceiptSchema,
        { ...current, ...values, updatedAt: context.now(), version: current.version + 1 },
        'invalid_input',
        '更新回执',
      );
      const fields = ['updatedAt', 'version', ...Object.keys(values)];
      const assignments = fields.map((field) => `${columnName(field)} = $${columnName(field)}`).join(', ');
      const params = encodeRow(Object.fromEntries(fields.map((field) => [field, COLUMNS[field] ?? 'text'])), next);
      const sql = `UPDATE receipts SET ${assignments} WHERE action_id = $action_id AND version = $expected_version`;
      if (context.db.run(sql, { ...params, action_id: actionId, expected_version: expectedVersion }) !== 1) {
        throw versionConflict('receipts', actionId, expectedVersion, get(actionId)?.version ?? expectedVersion);
      }
      return next;
    });
  }

  return {
    issue,
    get,
    update,
    withStatus: (status: Receipt['status']): Receipt[] => select('status = $status', { status }),
  };
}

export type ReceiptStore = ReturnType<typeof createReceiptStore>;
