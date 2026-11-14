import type { Migration } from './migrate.ts';

// 队友的画风和脸型（11-13 Aaron 定，弹框同意加两列）：已有的队友是扁平、萌脸，和换之前看起来一样。
// 主线的画风存在 kernel_settings 的 main_identity 里，不用改表。
export const migration: Migration = {
  id: '0136-mate-looks',
  up(db) {
    db.exec("ALTER TABLE mates ADD COLUMN variant TEXT NOT NULL DEFAULT 'solid'");
    db.exec("ALTER TABLE mates ADD COLUMN face TEXT NOT NULL DEFAULT 'cute'");
  },
};
