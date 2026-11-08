// 「删除」真的从库里抹掉（11-07 他在弹框里选「真的抹掉」）：以前「忘掉」只给记忆行和今天的记录打 deleted_at，
// 这一次把已经打了 deleted_at 的行一次性真删。撤不回：只删 deleted_at 非空的行（memory_doc_lines、memory_journal），
// 别的行、别的表的行一概不删。和以后的「忘掉」（brain 的 forgetMemory）一样，相关历史里存的原文一起抹掉：
// - 接替被删那一行的行（supersedes 里有它）上存的「之前：…」清空；
// - 昨晚整理的变更：写出那一行的，原文换成「（已忘掉）」；替换掉那一行的，「旧说法」清空；
// - 写成那一行的推断：原文换成「（已忘掉）」、理由清空（状态和他的确认不动）；
// - lines_forgotten 事件里他的原话（why）和行号去掉，只留删了几行；
// - 统一全文索引里如果还有这些行的条目（照理没有：deleted_at 的行不进索引），一起删。
// 删的时候用零覆盖（secure_delete），最后把全文索引的分段合并一遍，库文件里不留原文。

import type { Migration } from './migrate.ts';

const FORGOTTEN_TEXT = '（已忘掉）';
const GONE_LINES = 'SELECT id FROM memory_doc_lines WHERE deleted_at IS NOT NULL';
// 迁移拿不到业务时钟：改到的行的 updated_at 用 SQLite 的当前时间，ISO 格式和别处一致。
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
      // 外部内容的 FTS 要拿旧内容删词条，再删索引行。
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
