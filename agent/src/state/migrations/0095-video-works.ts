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
