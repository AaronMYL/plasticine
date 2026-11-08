import { isDeepStrictEqual } from 'node:util';
import { TermDecodingSchema, type TermDecoding } from '../../shared/state.ts';
import { checked, readRow, type ColumnMap } from './codec.ts';
import { StateError, notFound, versionConflict } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  id: 'text',
  termId: 'text',
  termVersion: 'integer',
  anchor: 'json',
  text: 'text',
  author: 'text',
  createdAt: 'text',
};

const LINE_REF = /^line:(.+):(\d+)$/;

export function createTermDecodings(context: StoreContext) {
  return {
    list(termId: string): TermDecoding[] {
      return context.db
        .all('SELECT * FROM term_decodings WHERE term_id = $id ORDER BY created_at DESC, id', {
          id: termId,
        })
        .map((row) => readRow(TermDecodingSchema, COLUMNS, row, 'term_decodings'));
    },
    record(input: TermDecoding): TermDecoding {
      const value = checked(TermDecodingSchema, input, 'invalid_input', '词语解码');
      const row = context.db.get('SELECT * FROM term_decodings WHERE id = $id', { id: value.id });
      if (row !== undefined) {
        const previous = readRow(TermDecodingSchema, COLUMNS, row, 'term_decodings');
        if (!isDeepStrictEqual(previous, { ...value, createdAt: previous.createdAt })) {
          throw new StateError('invalid_input', '这个解码动作已经使用过，请核对原来的记录。');
        }
        return previous;
      }
      const term = context.db.get("SELECT version FROM agreements WHERE id = $id AND kind = 'term'", {
        id: value.termId,
      });
      if (term === undefined) {
        throw notFound('agreements', value.termId);
      }
      if (value.termVersion !== Number(term['version']) && value.author !== 'migration') {
        throw versionConflict('agreements', value.termId, value.termVersion ?? 0, Number(term['version']));
      }
      if (value.anchor !== null) {
        // 对话的原话 2026-11-05 起在线里（line:<线>:<seq>，迁移 0059）。
        const line = LINE_REF.exec(value.anchor.ref);
        const said = 'SELECT seq FROM line_messages WHERE line_id = $line AND seq = $seq';
        const source = value.anchor.kind === 'message'
          ? line === null ? undefined : context.db.get(said, { line: line[1] ?? '', seq: Number(line[2]) })
          : context.db.get('SELECT id FROM notes WHERE id = $id', { id: value.anchor.ref });
        if (source === undefined) {
          throw new StateError('invalid_input', '解码的原话来路不存在，请重新核对。');
        }
      }
      context.db.run(
        `INSERT INTO term_decodings
        (id, term_id, term_version, anchor, text, author, created_at)
        VALUES ($id, $termId, $termVersion, $anchor, $text, $author, $createdAt)`,
        {
          ...value,
          anchor: value.anchor === null ? null : JSON.stringify(value.anchor),
        },
      );
      return value;
    },
  };
}
