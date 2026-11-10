// 收藏顺序来自抖音列表位置，旧日期没有来源证明，等待下一次全量同步核实。
// 空间关联由视频报告流程使用；旧作品、解析阶段和结果原样保留。
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0123-video-collection-order',
  up(db) {
    db.exec('ALTER TABLE video_works ADD COLUMN collect_seq INTEGER');
    db.exec('ALTER TABLE video_works ADD COLUMN space_id TEXT');
    db.exec('CREATE INDEX video_works_collection_order ON video_works (platform, collect_seq DESC, id DESC)');
  },
};
