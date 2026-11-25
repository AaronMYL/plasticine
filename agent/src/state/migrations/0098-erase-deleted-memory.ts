import type { Migration } from './migrate.ts';

const FORGOTTEN_TEXT = '（已忘掉）';
const GONE_LINES = 'SELECT id FROM memory_doc_lines WHERE deleted_at IS NOT NULL';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export const migration: Migration = {
  id: '0098-erase-deleted-memory',
  destructive: true,
  up(db) {
    db.exec('PRAGMA secure_delete = ON');
    try {
      db.run(`UPDATE memory_doc_lines SET previous = NULL, version = version + 1, updated_at = ${NOW}
        WHERE deleted_at IS NULL AND previous IS NOT NULL
          AND EXISTS (SELECT 1 FROM json_each(memory_doc_lines.supersedes) WHERE value IN (${GONE_LINES}))`);
      db.run(`UPDATE memory_dream_changes SET text = $text, version = version + 1, updated_at = ${NOW}
        WHERE line_id IN (${GONE_LINES}) AND text != $text`, { text: FORGOTTEN_TEXT });
      db.run(`UPDATE memory_dream_changes SET previous = NULL, version = version + 1, updated_at = ${NOW}
        WHERE old_line_id IN (${GONE_LINES}) AND previous IS NOT NULL`);
      db.run(`UPDATE memory_inferences SET text = $text, why = '', version = version + 1, updated_at = ${NOW}
        WHERE line_id IN (${GONE_LINES}) AND (text != $text OR why != '')`, { text: FORGOTTEN_TEXT });
      db.run(`UPDATE memory_doc_events
        SET detail = json_object('lines', COALESCE(json_array_length(detail, '$.lineIds'), 0))
        WHERE kind = 'lines_forgotten'`);
      db.run(`INSERT INTO search_fts (search_fts, rowid, title, body, detail)
        SELECT 'delete', id, title, body, detail FROM search_docs
        WHERE source = 'memory_line' AND ref IN (${GONE_LINES})`);
      db.run(`DELETE FROM search_docs WHERE source = 'memory_line' AND ref IN (${GONE_LINES})`);
      db.run('DELETE FROM memory_doc_lines WHERE deleted_at IS NOT NULL');
      db.run('DELETE FROM memory_journal WHERE deleted_at IS NOT NULL');
      db.run("INSERT INTO search_fts (search_fts) VALUES ('optimize')");
    } finally {
      db.exec('PRAGMA secure_delete = OFF');
    }
  },
};
