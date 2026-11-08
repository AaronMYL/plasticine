// 旧行存档（M3 迁移）：没有对应新对象的旧行——旧版的卡、观察的抽取批次、记忆维护索引、账本设置——整行原样存
// 一份，迁移校验据此逐条对照「一条不少」（《实施方案》第 4 节迁移规则 2）。主键是（库, 表, 旧 id），同一条旧行
// 只存一次：同样内容再存是空操作，换了内容就报错，不覆盖。先存档时还没有它挂靠的新对象（例如卡比命题先迁），
// 之后可以补上挂靠，但已挂靠的不能改挂别处。

import { LegacyRowInputSchema, LegacyRowSchema, type LegacyRow, type LegacyRowInput } from '../../shared/state.ts';
import { checked, encodeRow, readRow, sqlColumns, type ColumnMap } from './codec.ts';
import { fromSqliteError, StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  sourceDb: 'text',
  sourceTable: 'text',
  legacyId: 'text',
  targetTable: 'text',
  targetId: 'text',
  payload: 'json',
  reason: 'text',
  createdAt: 'text',
};
const INSERT_SQL = (() => {
  const { names, placeholders } = sqlColumns(COLUMNS);
  return `INSERT INTO legacy_rows (${names}) VALUES (${placeholders})`;
})();
const KEY = 'source_db = $source_db AND source_table = $source_table AND legacy_id = $legacy_id';

export type LegacyRecordOutcome = 'created' | 'unchanged' | 'attached';

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createLegacyRowStore(context: StoreContext) {
  function find(sourceDb: string, sourceTable: string, legacyId: string): LegacyRow | undefined {
    const row = context.db.get(`SELECT * FROM legacy_rows WHERE ${KEY}`, {
      source_db: sourceDb,
      source_table: sourceTable,
      legacy_id: legacyId,
    });
    return row === undefined ? undefined : readRow(LegacyRowSchema, COLUMNS, row, 'legacy_rows');
  }

  function conflict(input: LegacyRowInput, what: string): StateError {
    const old = `${input.sourceDb}.${input.sourceTable} ${input.legacyId}`;
    return new StateError('duplicate', `${old} 已经存档过，${what}；存档不覆盖`, { field: 'legacyId' });
  }

  return {
    find,
    record(input: LegacyRowInput): LegacyRecordOutcome {
      const values = checked(LegacyRowInputSchema, input, 'invalid_input', '存档旧行');
      return context.db.transaction(() => {
        const existing = find(values.sourceDb, values.sourceTable, values.legacyId);
        if (existing === undefined) {
          try {
            context.db.run(INSERT_SQL, encodeRow(COLUMNS, { ...values, createdAt: context.now() }));
          } catch (error) {
            throw fromSqliteError(error, '存档旧行');
          }
          return 'created';
        }
        if (!same(existing.payload, values.payload)) {
          throw conflict(values, '这次的内容和存档的不同');
        }
        const sameTarget = existing.targetId === values.targetId && existing.targetTable === values.targetTable;
        if (values.targetId === null || sameTarget) {
          return 'unchanged';
        }
        if (existing.targetId !== null) {
          throw conflict(values, `已挂在 ${existing.targetTable ?? ''} ${existing.targetId} 上`);
        }
        context.db.run(`UPDATE legacy_rows SET target_table = $target_table, target_id = $target_id WHERE ${KEY}`, {
          target_table: values.targetTable,
          target_id: values.targetId,
          source_db: values.sourceDb,
          source_table: values.sourceTable,
          legacy_id: values.legacyId,
        });
        return 'attached';
      });
    },
    /**
     * 整份快照类的存档（旧版采访排期 interview/plans.json）：旧版在两次拷贝之间还在写它，最后一次拷贝的内容
     * 和上次存的不同（10-29 切换时实测）。这时不覆盖旧存档：把它原样另存一条（id 加上它的存档时间），再让主存档
     * 换成这次的内容。同样内容是空操作。只给没有新对象的快照用，别的存档仍走 record() 的不覆盖规则。
     */
    supersede(input: LegacyRowInput): LegacyRecordOutcome {
      const values = checked(LegacyRowInputSchema, input, 'invalid_input', '存档旧行');
      return context.db.transaction(() => {
        const existing = find(values.sourceDb, values.sourceTable, values.legacyId);
        if (existing === undefined || same(existing.payload, values.payload)) {
          return this.record(values);
        }
        if (existing.targetId !== null || values.targetId !== null) {
          throw conflict(values, '挂着新对象的存档不能整份替换');
        }
        const kept = { ...existing, legacyId: `${existing.legacyId}@${existing.createdAt}` };
        if (find(kept.sourceDb, kept.sourceTable, kept.legacyId) === undefined) {
          context.db.run(INSERT_SQL, encodeRow(COLUMNS, kept));
        }
        context.db.run(`DELETE FROM legacy_rows WHERE ${KEY}`, {
          source_db: values.sourceDb,
          source_table: values.sourceTable,
          legacy_id: values.legacyId,
        });
        context.db.run(INSERT_SQL, encodeRow(COLUMNS, { ...values, createdAt: context.now() }));
        return 'created';
      });
    },
    /** Every archived row attached to one new object (a concern's 资料, M4), in the order they were archived. */
    forTarget(targetTable: string, targetId: string): LegacyRow[] {
      const sql = `SELECT * FROM legacy_rows WHERE target_table = $target_table AND target_id = $target_id
        ORDER BY created_at, source_table, legacy_id`;
      const rows = context.db.all(sql, { target_table: targetTable, target_id: targetId });
      return rows.map((row) => readRow(LegacyRowSchema, COLUMNS, row, 'legacy_rows'));
    },
    count(sourceDb: string, sourceTable: string): number {
      const sql = 'SELECT count(*) AS n FROM legacy_rows WHERE source_db = $source_db AND source_table = $source_table';
      return Number(context.db.get(sql, { source_db: sourceDb, source_table: sourceTable })?.['n'] ?? 0);
    },
  };
}

export type LegacyRowStore = ReturnType<typeof createLegacyRowStore>;
