// 视频解析与抖音收藏（《优化清单》第 9 条，11-06 定、11-07 改）。
// - video_works：一条作品（抖音收藏或任何视频链接），按 (platform, work_id) 去重；stage 只往前走：
//   synced 已同步 → previewed 已预览 → transcribed 已转写 → summarized 已总结。want 是他要它走到哪，run 是现在在不在动。
//   逐字稿、总结、实测（下载 / 转写耗时、峰值内存）都存在这一行，处理过的不重复。
// - video_folders：抖音收藏夹（同步时 Mac 交来的名字和条数）。
// - video_mac_jobs：要 Mac 做的事（翻收藏列表、取一条的下载地址）。Mac 不在线就一直排着，上线来取。

import type { Migration } from './migrate.ts';
import { inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const PLATFORMS = ['douyin', 'web'] as const;
const STAGES = ['synced', 'previewed', 'transcribed', 'summarized'] as const;
const WANTS = ['none', 'full'] as const;
const RUNS = ['idle', 'queued', 'waiting_mac', 'running', 'failed'] as const;

const WORKS = `CREATE TABLE video_works (${RECORD_COLUMNS},
  platform TEXT NOT NULL CHECK (platform IN ${inList(PLATFORMS)}),
  work_id TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT CHECK (kind IS NULL OR kind IN ('video', 'images')),
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  author TEXT,
  collected_at TEXT,
  duration_seconds REAL,
  ${jsonColumn('folder_ids', false)},
  stage TEXT NOT NULL CHECK (stage IN ${inList(STAGES)}),
  want TEXT NOT NULL CHECK (want IN ${inList(WANTS)}),
  run TEXT NOT NULL CHECK (run IN ${inList(RUNS)}),
  error TEXT,
  ${jsonColumn('preview', true)},
  transcript TEXT,
  transcript_source TEXT CHECK (transcript_source IS NULL
    OR transcript_source IN ('caption', 'subtitle', 'local', 'images')),
  ${jsonColumn('digest', true)},
  ${jsonColumn('resolved', true)},
  ${jsonColumn('timing', true)},
  feed_item_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  UNIQUE (platform, work_id)
)`;

const FOLDERS = `CREATE TABLE video_folders (
  platform TEXT NOT NULL CHECK (platform IN ${inList(PLATFORMS)}),
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER CHECK (count IS NULL OR count >= 0),
  synced_at TEXT NOT NULL,
  PRIMARY KEY (platform, folder_id)
)`;

const JOBS = `CREATE TABLE video_mac_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'resolve')),
  work_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'taken', 'done', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  taken_at TEXT,
  finished_at TEXT
)`;

export const migration: Migration = {
  id: '0095-video-works',
  up(db) {
    db.exec(WORKS);
    db.exec(FOLDERS);
    db.exec(JOBS);
    db.exec('CREATE INDEX video_works_list ON video_works (platform, collected_at DESC, id DESC)');
    db.exec('CREATE INDEX video_works_run ON video_works (run, updated_at)');
    db.exec('CREATE INDEX video_mac_jobs_state ON video_mac_jobs (state, created_at)');
  },
};
