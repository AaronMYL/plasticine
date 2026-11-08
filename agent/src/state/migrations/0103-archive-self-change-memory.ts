// 清掉记忆里的「改自己」（《优化清单》第 1 条，用户 11-07 定）：Plasticine 装的是打包好的发布版，不改自己的程序、不自己部署；
// 记忆文档里明确讲 Plasticine 自迭代、改自己源码、自己部署的在用行挪进归档（第 16 条三层的归档：不再给模型看，
// 问「以前怎么定的」还能搜到；不删）。原因记 no_longer_true，每行记一笔 line_retired 事件，索引里标成归档。
//
// 判断规则要保守，宁漏勿错（拿不准的留着，他在记忆页自己挪）。一行命中下面任意一条才算：
// 1. 出现只有 Plasticine 改自己、发自己时才会写的词：自迭代、自我迭代、self-iteration、它的工作区和旧版本目录、
//    部署脚本名、旧的 plasticine-self 账号（SELF_CHANGE_MARKERS）。
// 2. 「Plasticine / 橡皮泥」紧跟着（中间最多一个「要、会、能、可以……」）「自己 / 自行 + 改、部署、构建、发布、上线、
//    提交、推送」：「Plasticine 自己部署上线了三版」算，「朋友可以自己部署 Plasticine」不算。
// 3. 「Plasticine / 橡皮泥」紧跟着「改、修改、部署、构建、发布、上线 + 自己 / 自身」：「Plasticine 可以修改自己的源码」算，
//    「Plasticine 帮他改自己的简历」不算（「帮他」不在中间允许的那几个字里）。
// 只看在用的行（没退休、没删）；已经归档的、删掉的不动。这份文件发出去以后规则不再改（迁移是历史）。

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

/** 这一行是不是明确在讲 Plasticine 改自己、自己部署（规则见文件开头）。 */
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
      // 索引里只改归档标记（不是全文列，不用动 FTS）；没有条目的由回填补。
      db.run(`UPDATE search_docs SET archived = 1 WHERE source = 'memory_line' AND ref = $id`, { id });
    }
  },
};
