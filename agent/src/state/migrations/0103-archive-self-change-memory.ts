import type { Migration } from './migrate.ts';

export const SELF_CHANGE_MARKERS: readonly string[] = [
  '自迭代',
  '自我迭代',
  'self-iteration',
  'self_iteration',
  '/home/plasticine/workspaces',
  '/home/plasticine/releases',
  'deploy-tencent',
  'ship.ts',
  'plasticine-self',
];

const SUBJECT = '(?:plasticine|橡皮泥)\\s*';
const MODAL = '(?:要|会|能|可以|就|也|先|再|直接)?\\s*';
const ACTS = '(?:改|修改|部署|构建|发布|发版|上线|提交|推送)';
const SELF_FIRST = new RegExp(`${SUBJECT}${MODAL}(?:自己|自行)\\s*(?:动手\\s*)?${ACTS}`, 'i');
const ACT_FIRST = new RegExp(`${SUBJECT}${MODAL}(?:改|修改|修|部署|构建|发布|上线)\\s*它?(?:自己|自身)`, 'i');

export function talksAboutSelfChange(text: string): boolean {
  const lower = text.toLowerCase();
  if (SELF_CHANGE_MARKERS.some((marker) => lower.includes(marker))) {
    return true;
  }
  return SELF_FIRST.test(text) || ACT_FIRST.test(text);
}

const WHY = '用户 2026-11-07 定（《优化清单》第 1 条）：Plasticine 装的是打包好的发布版，不改自己的程序、不自己部署，'
  + '记忆里讲这些的行挪进归档';

export const migration: Migration = {
  id: '0103-archive-self-change-memory',
  up(db) {
    const at = String(db.all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")[0]?.['now']);
    const live = db.all(`SELECT id, doc_id, text FROM memory_doc_lines
      WHERE retired_at IS NULL AND deleted_at IS NULL AND archived_at IS NULL ORDER BY id`);
    const detail = JSON.stringify({ reason: 'no_longer_true', why: WHY });
    for (const row of live) {
      if (!talksAboutSelfChange(String(row['text']))) {
        continue;
      }
      const id = String(row['id']);
      const changed = db.run(`UPDATE memory_doc_lines SET retired_at = $at, retired_reason = 'no_longer_true',
          archived_at = $at, version = version + 1, updated_at = $at
        WHERE id = $id AND retired_at IS NULL`, { id, at });
      if (changed === 0) {
        continue;
      }
      db.run(`INSERT INTO memory_doc_events (id, doc_id, line_id, kind, actor, actor_ref, detail, created_at)
        VALUES (lower(hex(randomblob(16))), $doc, $id, 'line_retired', 'migration', NULL, $detail, $at)`,
      { doc: String(row['doc_id']), id, detail, at });
      db.run(`UPDATE search_docs SET archived = 1 WHERE source = 'memory_line' AND ref = $id`, { id });
    }
  },
};
