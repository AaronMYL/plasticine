import type { Migration } from './migrate.ts';

// 第 97 条及 10-29 用户要求：升级时打开已有自迭代组；迁移仅执行一次，之后用户仍可关闭。
export const migration: Migration = {
  id: '0027-self-code-enabled',
  up(db) {
    db.exec(`UPDATE tool_groups SET enabled = 1, version = version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'self_code' AND enabled = 0`);
  },
};
