// 2026-11-04 联系人走查：Plasticine 自己寄给自己的通知信（「Plasticine · 今天的…」「Plasticine：…」）以前收进来记成
// email，在联系人里成了一个叫 Plasticine 的邮件联系人，「设置 · 通知记录」反而断在 10-29。收信那头已经改成记 plasticine
// 来源（cloud-tools/own-notice.ts）；这里用同一条规则把已经收进来的改过来：来源、寄件人、去掉前缀的标题，
// 以及这些信记成的触发（原来记成那个邮箱地址说的话，改成 Plasticine 自己说的）。只改值，不删行。

import type { Migration } from './migrate.ts';

// 自己寄给自己（收件人里有寄件地址）、标题是 Plasticine 后面跟（空格）「·」「：」「:」。
const OWN_NOTICE = `source = 'email' AND trim(from_address) <> ''
  AND instr(lower(coalesce(to_address, '')), lower(trim(from_address))) > 0
  AND substr(title, 1, 10) = 'Plasticine'
  AND substr(ltrim(substr(title, 11), ' '), 1, 1) IN ('·', '：', ':')`;

const STRIPPED = "trim(substr(ltrim(substr(title, 11), ' '), 2), ' ')";

export const migration: Migration = {
  id: '0048-own-notices',
  up(db) {
    db.exec(`UPDATE triggers SET actor = 'plasticine', actor_source_kind = 'own_reasoning'
      WHERE ref_type = 'inbox_message' AND ref_id IN (SELECT id FROM inbox_messages WHERE ${OWN_NOTICE})`);
    db.exec(`UPDATE inbox_messages SET
      source = 'plasticine',
      from_address = 'plasticine',
      from_name = NULL,
      title = CASE WHEN ${STRIPPED} = '' THEN '（没有标题）' ELSE ${STRIPPED} END,
      version = version + 1
      WHERE ${OWN_NOTICE}`);
  },
};
