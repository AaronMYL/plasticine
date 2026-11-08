// 网站图标的缓存（11-08 他定「网页的标签要能够显示对应网站的图标」）：本体按域名去那个网站自己取，存在这里，过了
// expires_at 再取一次。取不到的也记一行（status = none、没有字节），免得每次画标签都去敲一遍；同样到期再试。
// 只加表；一个域名一行，再取时原地更新。

import type { Migration } from './migrate.ts';

const FAVICONS = `CREATE TABLE web_favicons (
  host TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'none')),
  mime TEXT,
  data BLOB,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((status = 'ok') = (data IS NOT NULL AND mime IS NOT NULL))
)`;

export const migration: Migration = {
  id: '0110-favicons',
  up(db) {
    db.exec(FAVICONS);
    db.exec('CREATE INDEX web_favicons_expiry ON web_favicons (expires_at)');
  },
};
