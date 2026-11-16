// 第二批能力（11-16 能力总表，用户定「照总表加」）：
// - lines.plan：线自己列的步骤清单（line_plan），JSON：[{ text, status }]；没列过是 NULL。
// - line_watches 多一种：盯 Mac 上授权文件夹里的变化（folder）。SQLite 改不了 CHECK，只能照原样建新表、把行原样搬过去、
//   删旧表、换名字、重建索引（和 0137 一样的官方重建步骤，所以标 destructive）；别的列和约束一个不变，一行不少。
// - pushes：推到他手机上的每一条（谁推的、推了什么、什么时候、撤回没有），记忆 · 主动告诉你里看得到、能撤回。
// - connections：他在设置里连的服务（MCP），名字、连接地址、拿到的工具清单、连没连上。令牌不进库：存在凭据目录
//   （credentials/，0600），这里只记凭据的名字。

import type { Migration } from './migrate.ts';
import { inList } from './sql.ts';

export const migration: Migration = {
  id: '0146-plans-pushes-connections',
  destructive: true,
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN plan TEXT');
    db.exec(`CREATE TABLE line_watches_new (id TEXT PRIMARY KEY NOT NULL, line_id TEXT NOT NULL REFERENCES lines(id),
      call_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT, node_id TEXT, tab_id TEXT, folder TEXT,
      look_for TEXT, every_minutes INTEGER NOT NULL CHECK (every_minutes >= 1), until_at TEXT NOT NULL,
      next_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ${inList(['on', 'off', 'ended'])}),
      checks INTEGER NOT NULL DEFAULT 0, changes INTEGER NOT NULL DEFAULT 0, last_text TEXT, last_checked_at TEXT,
      last_error TEXT, created_at TEXT NOT NULL, ended_at TEXT,
      CHECK ((url IS NOT NULL) + (tab_id IS NOT NULL) + (folder IS NOT NULL) = 1),
      CHECK ((node_id IS NULL) = (url IS NOT NULL)))`);
    db.exec(`INSERT INTO line_watches_new (id, line_id, call_key, title, url, node_id, tab_id, folder, look_for,
      every_minutes, until_at, next_at, status, checks, changes, last_text, last_checked_at, last_error, created_at,
      ended_at)
      SELECT id, line_id, call_key, title, url, node_id, tab_id, NULL, look_for, every_minutes, until_at, next_at,
      status, checks, changes, last_text, last_checked_at, last_error, created_at, ended_at FROM line_watches`);
    db.exec('DROP TABLE line_watches');
    db.exec('ALTER TABLE line_watches_new RENAME TO line_watches');
    db.exec('CREATE INDEX line_watches_next ON line_watches(status, next_at)');
    db.exec(`CREATE TABLE pushes (id TEXT PRIMARY KEY NOT NULL, line_id TEXT NOT NULL REFERENCES lines(id),
      call_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL,
      withdrawn_at TEXT)`);
    db.exec('CREATE INDEX pushes_recent ON pushes(created_at)');
    db.exec(`CREATE TABLE connections (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
      credential TEXT, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)), tools TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ${inList(['untested', 'ok', 'error'])}), error TEXT, checked_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
  },
};
