// 长期维护入口的操作记录（第 115 条，迁移 0050）：每次写操作一行——操作号、做了什么、参数、用户的原话、结果。
// 操作号是主键：同一个号再来只回这一行的结果，不再动一次（运维 Issue 重跑也安全）。

import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface MaintenanceOperation {
  id: string;
  op: string;
  args: unknown;
  /** 用户的原话（弹框里的回答或他说的话）。 */
  because: string;
  result: unknown;
  createdAt: string;
}

export interface MaintenanceOperationInput {
  id: string;
  op: string;
  args: unknown;
  because: string;
  result: unknown;
}

function operation(row: Row): MaintenanceOperation {
  return {
    id: String(row['id']),
    op: String(row['op']),
    args: JSON.parse(String(row['args'])) as unknown,
    because: String(row['because']),
    result: JSON.parse(String(row['result'])) as unknown,
    createdAt: String(row['created_at']),
  };
}

export function createMaintenanceOperationStore(context: StoreContext) {
  const { db } = context;
  return {
    get(id: string): MaintenanceOperation | undefined {
      const row = db.get('SELECT * FROM maintenance_operations WHERE id = $id', { id });
      return row === undefined ? undefined : operation(row);
    },
    record(input: MaintenanceOperationInput): MaintenanceOperation {
      db.run(`INSERT INTO maintenance_operations (id, op, args, because, result, created_at)
        VALUES ($id, $op, $args, $because, $result, $at)`, {
        id: input.id,
        op: input.op,
        args: JSON.stringify(input.args),
        because: input.because,
        result: JSON.stringify(input.result),
        at: context.now(),
      });
      return this.get(input.id)!;
    },
    recent(limit = 20): MaintenanceOperation[] {
      return db.all('SELECT * FROM maintenance_operations ORDER BY created_at DESC, id DESC LIMIT $limit', { limit })
        .map(operation);
    },
  };
}
