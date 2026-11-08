// 「今天的记录」的存取（《优化清单》第 10 条白天部分，11-06 定）：只追加；白天谁都不改、不合并、不删。
// 夜里的整理读完一批就挪进归档（archived_at + dream_id）；归档满 30 天、或他说「忘掉」的，从库里真的删掉（11-07 他定，
// 删掉的内容用零覆盖）。deleted_at 这一列留着不用：以前打过的由迁移 0098 一次删净。
// 什么时候记、记什么由脑决定；这里只管存取。

import {
  MEMORY_JOURNAL_RETENTION_DAYS,
  MemoryJournalEntrySchema,
  MemoryJournalInputSchema,
  type MemoryJournalEntry,
  type MemoryJournalInput,
} from '../../shared/state.ts';
import { checked, encodeRow, readRow, sqlColumns, type ColumnMap } from './codec.ts';
import { fromSqliteError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  id: 'text',
  createdAt: 'text',
  day: 'text',
  kind: 'text',
  text: 'text',
  anchors: 'json',
  docId: 'text',
  lineId: 'text',
  writtenBy: 'text',
  writtenRef: 'text',
  dreamId: 'text',
  archivedAt: 'text',
  deletedAt: 'text',
};

const DAY_MS = 86_400_000;
// 一次读回来的上限：一天对话再多，也不会有几千条短记录；真到了就是有东西在刷，宁可截断。
const READ_LIMIT = 2_000;

export function createMemoryJournalStore(context: StoreContext) {
  const { names, placeholders } = sqlColumns(COLUMNS);
  // 同一时刻写的几条按写入的先后（rowid）。
  const read = (where: string, params: Record<string, string | number> = {}, order = 'created_at, rowid') =>
    context.db.all(`SELECT * FROM memory_journal WHERE ${where} ORDER BY ${order} LIMIT ${READ_LIMIT}`, params)
      .map((row) => readRow(MemoryJournalEntrySchema, COLUMNS, row, 'memory_journal'));
  const get = (id: string): MemoryJournalEntry | undefined => read('id = $id', { id })[0];
  return {
    /** 追加一条（带出处）。 */
    add(input: MemoryJournalInput): MemoryJournalEntry {
      const values = checked(MemoryJournalInputSchema, input, 'invalid_input', '写 memory_journal');
      const entry = checked(MemoryJournalEntrySchema, { docId: null, lineId: null, writtenRef: null, ...values,
        id: context.newId(), createdAt: context.now(), dreamId: null, archivedAt: null, deletedAt: null },
      'invalid_input', '写 memory_journal');
      try {
        context.db.run(`INSERT INTO memory_journal (${names}) VALUES (${placeholders})`, encodeRow(COLUMNS, entry));
      } catch (error) {
        throw fromSqliteError(error, '写 memory_journal');
      }
      return entry;
    },
    get,
    /** 还没整理的（= 白天给模型看的「今天的记录」），按写的先后。 */
    open: (): MemoryJournalEntry[] => read('archived_at IS NULL AND deleted_at IS NULL'),
    /** 已整理进归档、还没到删除的，最近的在前。 */
    archived: (): MemoryJournalEntry[] => read('archived_at IS NOT NULL AND deleted_at IS NULL',
      {}, 'archived_at DESC, rowid DESC'),
    /** 一次整理读完这几条：挪进归档、记是哪一次整理。已经归档或删除的不动。 */
    archive(ids: readonly string[], dreamId: string): MemoryJournalEntry[] {
      return context.db.transaction(() => {
        const at = context.now();
        for (const id of ids) {
          context.db.run(`UPDATE memory_journal SET archived_at = $at, dream_id = $dream
            WHERE id = $id AND archived_at IS NULL AND deleted_at IS NULL`, { at, dream: dreamId, id });
        }
        return ids.map(get).filter((entry): entry is MemoryJournalEntry => entry?.dreamId === dreamId);
      });
    },
    /** 归档满 30 天的从库里删掉（第 16 条；11-07 定真删）；返回这次删了几条。 */
    expire(now: Date): number {
      const before = new Date(now.getTime() - MEMORY_JOURNAL_RETENTION_DAYS * DAY_MS).toISOString();
      return context.db.erasing(() => context.db.run(`DELETE FROM memory_journal
        WHERE archived_at IS NOT NULL AND archived_at < $before`, { before }));
    },
    /** 他说「忘掉」时，记录里提到同一件事的那几条也从库里删掉；返回删了几条。 */
    forget(ids: readonly string[]): number {
      return context.db.erasing(() => ids.reduce((sum, id) => sum + context.db.run(
        'DELETE FROM memory_journal WHERE id = $id', { id }), 0));
    },
  };
}

export type MemoryJournalStore = ReturnType<typeof createMemoryJournalStore>;
