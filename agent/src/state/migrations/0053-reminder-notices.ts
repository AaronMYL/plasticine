// 2026-11-04 用户定「到点的『提醒：…』信加前缀，进后台『通知信』」：以后寄出的提醒信标题带「Plasticine：」
// （execution/notification-mail.ts 的 reminderSubject），收回来按通知信认。已经收进来的、自己寄给自己（收件人里有寄件
// 地址）的「提醒：…」信，这里改记成 plasticine 来源，和 0048 一样连同它记成的触发一起改。只改值，不删行，标题照旧。

import type { Migration } from './migrate.ts';

const OWN_REMINDER = `source = 'email' AND trim(from_address) <> ''
  AND instr(lower(coalesce(to_address, '')), lower(trim(from_address))) > 0
  AND substr(title, 1, 3) = '提醒：'`;

export const migration: Migration = {
  id: '0053-reminder-notices',
  up(db) {
    db.exec(`UPDATE triggers SET actor = 'plasticine', actor_source_kind = 'own_reasoning'
      WHERE ref_type = 'inbox_message' AND ref_id IN (SELECT id FROM inbox_messages WHERE ${OWN_REMINDER})`);
    db.exec(`UPDATE inbox_messages SET source = 'plasticine', from_address = 'plasticine', from_name = NULL,
      version = version + 1
      WHERE ${OWN_REMINDER}`);
  },
};
