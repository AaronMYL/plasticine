// 旧 id → 新 id 映射（《实施方案》第 4 节迁移规则 1：可重跑、幂等，按旧 id 映射表去重）。同一条旧记录只映射
// 一次：再映射到同一个新 id 是空操作，映射到别的新 id 就报错，导入脚本据此跳过已迁过的行。

import { LegacyIdSchema, type LegacyId } from '../../shared/state.ts';
import { checked, encodeRow, type ColumnMap } from './codec.ts';
import { fromSqliteError, StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  sourceDb: 'text',
  sourceTable: 'text',
  legacyId: 'text',
  targetTable: 'text',
  targetId: 'text',
  createdAt: 'text',
};
const FIND_SQL = `SELECT target_table, target_id FROM legacy_ids
  WHERE source_db = $source_db AND source_table = $source_table AND legacy_id = $legacy_id`;
const INSERT_SQL = `INSERT INTO legacy_ids (source_db, source_table, legacy_id, target_table, target_id, created_at)
  VALUES ($source_db, $source_table, $legacy_id, $target_table, $target_id, $created_at)`;

export interface LegacyTarget {
  targetTable: string;
  targetId: string;
}

export function createLegacyIdMap(context: StoreContext) {
  function find(sourceDb: string, sourceTable: string, legacyId: string): LegacyTarget | undefined {
    const row = context.db.get(FIND_SQL, { source_db: sourceDb, source_table: sourceTable, legacy_id: legacyId });
    if (row === undefined) {
      return undefined;
    }
    return { targetTable: String(row['target_table']), targetId: String(row['target_id']) };
  }

  return {
    find,
    /** Returns true when the mapping is new, false when the same mapping was already recorded. */
    record(mapping: LegacyId): boolean {
      const values = checked(LegacyIdSchema, mapping, 'invalid_input', '写 legacy_ids');
      return context.db.transaction(() => {
        const existing = find(values.sourceDb, values.sourceTable, values.legacyId);
        if (existing !== undefined) {
          if (existing.targetTable === values.targetTable && existing.targetId === values.targetId) {
            return false;
          }
          const old = `${values.sourceDb}.${values.sourceTable} ${values.legacyId}`;
          const message = `${old} 已映射到 ${existing.targetTable} ${existing.targetId}，同一旧 id 只能映射一次`;
          throw new StateError('duplicate', message, { field: 'legacyId' });
        }
        try {
          context.db.run(INSERT_SQL, encodeRow(COLUMNS, { ...values, createdAt: context.now() }));
        } catch (error) {
          throw fromSqliteError(error, '写 legacy_ids');
        }
        return true;
      });
    },
  };
}

export type LegacyIdMap = ReturnType<typeof createLegacyIdMap>;
