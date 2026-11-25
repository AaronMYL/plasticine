import { InboxMailPartSchema, type InboxMailPart } from '../../shared/state.ts';
import { checked, encodeRow, readRow, sqlColumns, type ColumnMap } from './codec.ts';
import { fromSqliteError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const PART_COLUMNS: ColumnMap = {
  id: 'text',
  messageId: 'text',
  contentId: 'text',
  filename: 'text',
  type: 'text',
  size: 'integer',
  path: 'text',
  createdAt: 'text',
};

export function createInboxMailParts(context: StoreContext) {
  const { names, placeholders } = sqlColumns(PART_COLUMNS);
  const insert = `INSERT INTO inbox_mail_parts (${names}) VALUES (${placeholders})
    ON CONFLICT (message_id, content_id) DO NOTHING`;
  return {
    add(input: Omit<InboxMailPart, 'id' | 'createdAt'>): boolean {
      const part = checked(InboxMailPartSchema, { ...input, id: context.newId(), createdAt: context.now() },
        'invalid_input', '记一个内嵌分段');
      try {
        return context.db.run(insert, encodeRow(PART_COLUMNS, part)) === 1;
      } catch (error) {
        throw fromSqliteError(error, '记一个内嵌分段');
      }
    },
    forMessage(messageId: string): InboxMailPart[] {
      return context.db.all('SELECT * FROM inbox_mail_parts WHERE message_id = $message_id ORDER BY created_at, id',
        { message_id: messageId }).map((row) => readRow(InboxMailPartSchema, PART_COLUMNS, row, 'inbox_mail_parts'));
    },
  };
}

