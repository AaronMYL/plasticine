// 做事经验按网站带出、记用量（内核优化第二批，11-17 Aaron 授权「memory_docs 加三列」）：
// - sites：这一篇对应哪些网站或应用（域名如 mp.weixin.qq.com、应用名如「微信」），JSON 数组。线碰到这个网站时，内核把
//   这一篇挂在那一步的结果后面带出来，不靠模型记得去读（线上 12 天做事经验只被读了 9 次）。
// - use_count / last_used_at：被带出过几次、最近一次。用来看哪些经验有用、哪些一直没人用。
// 只加列，不动已有的行；三列都不进记忆文档的对象格式（接口不变），只由 state/memory-doc-usage.ts 读写。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0148-memory-doc-usage',
  up(db) {
    db.exec(`ALTER TABLE memory_docs ADD COLUMN sites TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sites))`);
    db.exec('ALTER TABLE memory_docs ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0)');
    db.exec('ALTER TABLE memory_docs ADD COLUMN last_used_at TEXT');
  },
};
