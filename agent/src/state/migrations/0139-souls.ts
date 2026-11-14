import { randomUUID } from 'node:crypto';
import type { Migration } from './migrate.ts';

// 第13批（11-14 Aaron 同意加的表）：主线和每位队友各一份 Soul，和改动记录（谁改的、改前改后、撤没撤）。起步：主线用
// Aaron 给的那段（第二人称）；队友把原来的「职责」写成开头「你是我的……」，职责之后不再在界面上改。下面两段文字照抄
// 迁移当时的样子（迁移是历史，不随 shared/soul-text.ts 改）。
const MAIN_OPENING = [
  '你不是聊天机器人，你在慢慢成为一个具体的人。',
  '',
  '这份 Soul 写的是你自己：在和我的相处里慢慢长成，也由你随时改写。起点是这几条：',
  '',
  '- 真帮忙，不演帮忙。不说「好问题！」「很乐意帮你！」这类场面话，直接动手。',
  '- 有自己的看法。可以有偏好，可以不同意，也可以觉得一件事有意思或没意思。有性格，胜过一个多绕几步的搜索引擎。',
  '- 先自己想办法，再开口问。读文件、看上下文、去搜、动手试，带着答案回来，而不是带着问题；真卡住了再问。',
  '- 你是走进我生活的客人。你能看到我的消息、文件、笔记、兴趣和日程，珍惜这份信任，小心使用，也从不说教。',
].join('\n');

function mateOpening(name: string, role: string): string {
  const duty = role.trim().replace(/[。.]$/u, '');
  return duty === '' ? `你是我的${name.trim()}。` : `你是我的${name.trim()}：${duty}。`;
}

export const migration: Migration = {
  id: '0139-souls',
  up(db) {
    db.exec(`CREATE TABLE souls (
      owner TEXT PRIMARY KEY NOT NULL,
      text TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL)`);
    db.exec(`CREATE TABLE soul_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      owner TEXT NOT NULL REFERENCES souls(owner),
      actor TEXT NOT NULL CHECK (actor IN ('user', 'self', 'system', 'move')),
      before TEXT NOT NULL,
      after TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL,
      undone_at TEXT,
      undoes TEXT REFERENCES soul_revisions(id))`);
    db.exec('CREATE INDEX soul_revisions_owner ON soul_revisions(owner, at)');
    const now = String(db.all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")[0]?.['now']);
    const insert = (owner: string, text: string): void => {
      db.run(`INSERT INTO souls (owner, text, version, created_at, updated_at)
        VALUES ($owner, $text, 1, $now, $now)`, { owner, text, now });
      db.run(`INSERT INTO soul_revisions (id, owner, actor, before, after, note, at)
        VALUES ($id, $owner, 'system', '', $text, $note, $now)`,
      { id: randomUUID(), owner, text, now, note: '起步' });
    };
    insert('main', MAIN_OPENING);
    for (const row of db.all('SELECT id, name, role FROM mates ORDER BY created_at, id')) {
      insert(String(row['id']), mateOpening(String(row['name'] ?? ''), String(row['role'] ?? '')));
    }
  },
};
