// 11-17 全量审计的四件库内的事里，表结构这两件（另两件「回执正文只留 30 天」「过期接口回执清掉」是每天跑的清理，
// 在 system/record-sweep.ts，不在迁移里）：
// 一、设备动作表补两个索引。这张表只进不出（线上 3 万多行、76 MB）：
//   - (requested_at, id)：设备页「最近的动作」和每天清旧回执正文都按时间扫，原来没有索引可用，整表排序；
//   - (run_id, node_id, requested_at)：一条线在一台设备上做过什么（发出去之前核对这一页的提交），原来按设备扫。
// 二、删掉没有代码再读写的九张表：
//   - pairing_codes：旧的浏览器配对码（配对早改成登录，11-17 连命令行入口一起删了）；
//   - mail_fallback_settings / notification_mail_status：推送不通时改发邮件，功能 11-04 就停了；
//   - client_updates：自迭代时代每一版界面的整份资源清单（现在的界面版本直接读发布目录，登记在 client_publications）；
//   - intake_sources / triggers / trigger_dispositions / rules / rule_events：进门规则（来的东西先记一条触发、粗筛、
//     按规则分去向）。规则 11-06 全关了（0092），之后只有心跳还读触发里「来信、会议邀请、信息流命中关注点」三类，
//     现在心跳直接读站内信和信息流自己的表（state/heartbeat-facts.ts）。
//   心跳记着上一跳见过哪些事（timed_slots.memo.seen），来信和信息流那几个 key 原来带的是触发的 id，现在带原记录的
//   id：删表之前照触发表换过来，升级后的第一跳才不会把已经看过的来信、信息流当成新的再说一遍。
// 线上删之前这九张表先整张导出留底 7 天（ship.ts keep）。删的时候用零覆盖（secure_delete）。

import type { Migration } from './migrate.ts';

// 先删指着别人的，再删被指的（迁移跑的时候外键是关的，顺序只是为了读着清楚）。
const RETIRED_TABLES = [
  'trigger_dispositions', 'triggers', 'intake_sources', 'rule_events', 'rules',
  'pairing_codes', 'mail_fallback_settings', 'notification_mail_status', 'client_updates',
] as const;

// 「mail:」「feed:」都是 5 个字符，后面跟着触发的 id；找不到对应触发的 key 原样留着。
const SEEN_KEYS = `UPDATE timed_slots SET memo = json_set(memo, '$.seen', json((
    SELECT json_group_array(COALESCE((SELECT substr(seen.value, 1, 5) || t.ref_id FROM triggers t
      WHERE (seen.value LIKE 'mail:%' OR seen.value LIKE 'feed:%') AND t.id = substr(seen.value, 6)
        AND t.ref_id IS NOT NULL), seen.value))
    FROM json_each(timed_slots.memo, '$.seen') seen)))
  WHERE source = 'heartbeat' AND json_type(memo, '$.seen') = 'array'`;

export const migration: Migration = {
  id: '0147-retired-tables-action-indexes',
  destructive: true,
  changes: [...RETIRED_TABLES],
  up(db) {
    db.exec('CREATE INDEX node_actions_requested ON node_actions (requested_at, id)');
    db.exec('CREATE INDEX node_actions_run_node ON node_actions (run_id, node_id, requested_at)');
    db.exec(SEEN_KEYS);
    db.exec('PRAGMA secure_delete = ON');
    try {
      for (const table of RETIRED_TABLES) {
        db.exec(`DROP TABLE ${table}`);
      }
    } finally {
      db.exec('PRAGMA secure_delete = OFF');
    }
  },
};
