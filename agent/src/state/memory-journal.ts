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
const READ_LIMIT = 2_000;

export function createMemoryJournalStore(context: StoreContext) {
  const { names, placeholders } = sqlColumns(COLUMNS);
  const read = (where: string, params: Record<string, string | number> = {}, order = 'created_at, rowid') =>
    context.db.all(`SELECT * FROM memory_journal WHERE ${where} ORDER BY ${order} LIMIT ${READ_LIMIT}`, params)
      .map((row) => readRow(MemoryJournalEntrySchema, COLUMNS, row, 'memory_journal'));
  const get = (id: string): MemoryJournalEntry | undefined => read('id = $id', { id })[0];
  return {
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
    open: (): MemoryJournalEntry[] => read('archived_at IS NULL AND deleted_at IS NULL'),
    archived: (): MemoryJournalEntry[] => read('archived_at IS NOT NULL AND deleted_at IS NULL',
      {}, 'archived_at DESC, rowid DESC'),
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
    expire(now: Date): number {
      const before = new Date(now.getTime() - MEMORY_JOURNAL_RETENTION_DAYS * DAY_MS).toISOString();
      return context.db.erasing(() => context.db.run(`DELETE FROM memory_journal
        WHERE archived_at IS NOT NULL AND archived_at < $before`, { before }));
    },
    forget(ids: readonly string[]): number {
      return context.db.erasing(() => ids.reduce((sum, id) => sum + context.db.run(
        'DELETE FROM memory_journal WHERE id = $id', { id }), 0));
    },
  };
}

export type MemoryJournalStore = ReturnType<typeof createMemoryJournalStore>;
