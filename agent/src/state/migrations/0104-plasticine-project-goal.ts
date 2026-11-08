// 常驻项目「Plasticine」的目标（《优化清单》第 1 条，用户 11-07 定「清掉上下文里的改自己」）：系统建项目时写的旧说法
// 带着「还没做完的改造」，每轮都进这条项目线的提示。还是那句原话才换成新说法（他改过的不动），旧说法记进项目事件。

import type { Migration } from './migrate.ts';

const PROJECT_ID = 'project-plasticine';
const OLD_GOAL = 'Plasticine 自己：合作关系、审查建议和还没做完的改造。';
const NEW_GOAL = 'Plasticine 自己：和他怎么合作，用下来哪里顺手、哪里不好用。';

export const migration: Migration = {
  id: '0104-plasticine-project-goal',
  up(db) {
    const row = db.all('SELECT brief FROM projects WHERE id = $id', { id: PROJECT_ID })[0];
    if (row === undefined) {
      return;
    }
    const brief = JSON.parse(String(row['brief'])) as Record<string, unknown>;
    if (brief['goal'] !== OLD_GOAL) {
      return;
    }
    const at = String(db.all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")[0]?.['now']);
    db.run(`UPDATE projects SET brief = $brief, version = version + 1, updated_at = $at WHERE id = $id`,
      { brief: JSON.stringify({ ...brief, goal: NEW_GOAL }), at, id: PROJECT_ID });
    db.run(`INSERT INTO project_events (id, project_id, kind, text, actor, actor_ref, created_at)
      VALUES (lower(hex(randomblob(16))), $id, 'edited', $text, 'migration', NULL, $at)`,
    { id: PROJECT_ID, at, text: `目标换成新说法（不再讲改造自己）；原来是「${OLD_GOAL}」` });
  },
};
