import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import {
  VIDEO_STAGES, VideoDigestSchema, VideoPreviewSchema, VideoTimingSchema, DouyinResolvedSchema, type DouyinFolderView,
  type DouyinResolved, type VideoDigest, type VideoPlatform, type VideoPreview, type VideoRun, type VideoStage,
  type VideoTiming,
} from '../../shared/api/video.ts';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';
import { createMacJobStore } from './video-mac-jobs.ts';

export interface VideoWorkRow {
  id: string;
  platform: VideoPlatform;
  workId: string;
  url: string;
  kind: 'video' | 'images' | null;
  title: string;
  caption: string;
  author: string | null;
  collectedAt: string | null;
  collectSeq: number | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  folderIds: string[];
  stage: VideoStage;
  want: 'none' | 'full';
  run: VideoRun;
  error: string | null;
  preview: VideoPreview | null;
  transcript: string | null;
  transcriptSource: 'caption' | 'subtitle' | 'local' | 'images' | null;
  digest: VideoDigest | null;
  resolved: DouyinResolved | null;
  timing: VideoTiming | null;
  feedItemId: string | null;
  spaceId: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NewVideoWork {
  platform: VideoPlatform;
  workId: string;
  url: string;
  title: string;
  caption?: string;
  author?: string | null;
  kind?: 'video' | 'images' | null;
  collectedAt?: string | null;
  collectSeq?: number;
  collectSeqBase?: number;
  durationSeconds?: number | null;
  coverUrl?: string | null;
  folderIds?: string[];
}

export interface VideoAdvance {
  stage?: VideoStage;
  run?: VideoRun;
  error?: string | null;
  kind?: 'video' | 'images';
  caption?: string;
  durationSeconds?: number | null;
  preview?: VideoPreview;
  transcript?: string;
  transcriptSource?: 'caption' | 'subtitle' | 'local' | 'images';
  digest?: VideoDigest;
  resolved?: DouyinResolved | null;
  timing?: VideoTiming;
  feedItemId?: string;
  spaceId?: string;
}

export interface VideoPageFilter {
  platform: VideoPlatform;
  folder?: string;
  q?: string;
  phase?: 'todo' | 'done';
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function json<T>(row: Row, key: string, check: (value: unknown) => value is T): T | null {
  const raw = row[key];
  if (typeof raw !== 'string') {
    return null;
  }
  const value: unknown = JSON.parse(raw);
  if (!check(value)) {
    throw new StateError('corrupt_record', `video_works.${key} 的形状不对（${String(row['id'])}）。`);
  }
  return value;
}

const isDigest = (value: unknown): value is VideoDigest => Value.Check(VideoDigestSchema, value);
const isPreview = (value: unknown): value is VideoPreview => Value.Check(VideoPreviewSchema, value);
const isTiming = (value: unknown): value is VideoTiming => Value.Check(VideoTimingSchema, value);
const isResolved = (value: unknown): value is DouyinResolved => Value.Check(DouyinResolvedSchema, value);
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function decodeWork(row: Row): VideoWorkRow {
  const kind = nullableText(row, 'kind');
  const source = nullableText(row, 'transcript_source');
  const duration = row['duration_seconds'];
  return {
    id: String(row['id']),
    platform: row['platform'] === 'douyin' ? 'douyin' : 'web',
    workId: String(row['work_id']),
    url: String(row['url']),
    kind: kind === 'video' || kind === 'images' ? kind : null,
    title: String(row['title']),
    caption: String(row['caption']),
    author: nullableText(row, 'author'),
    collectedAt: nullableText(row, 'collected_at'),
    collectSeq: typeof row['collect_seq'] === 'number' ? row['collect_seq'] : null,
    durationSeconds: typeof duration === 'number' ? duration : null,
    coverUrl: nullableText(row, 'cover_url'),
    folderIds: json(row, 'folder_ids', isStrings) ?? [],
    stage: VIDEO_STAGES.find((stage) => stage === row['stage']) ?? 'synced',
    want: row['want'] === 'full' ? 'full' : 'none',
    run: (['idle', 'queued', 'waiting_mac', 'running', 'failed'] as const).find((run) => run === row['run']) ?? 'idle',
    error: nullableText(row, 'error'),
    preview: json(row, 'preview', isPreview),
    transcript: nullableText(row, 'transcript'),
    transcriptSource: source === 'caption' || source === 'subtitle' || source === 'local' || source === 'images'
      ? source : null,
    digest: json(row, 'digest', isDigest),
    resolved: json(row, 'resolved', isResolved),
    timing: json(row, 'timing', isTiming),
    feedItemId: nullableText(row, 'feed_item_id'),
    spaceId: nullableText(row, 'space_id'),
    attempts: Number(row['attempts']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
    version: Number(row['version']),
  };
}

function stageIndex(stage: VideoStage): number {
  return VIDEO_STAGES.indexOf(stage);
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function createVideoWorkStore(context: StoreContext) {
  const { db } = context;
  const get = (id: string): VideoWorkRow | undefined => {
    const row = db.get('SELECT * FROM video_works WHERE id = $id', { id });
    return row === undefined ? undefined : decodeWork(row);
  };
  const require = (id: string): VideoWorkRow => {
    const found = get(id);
    if (found === undefined) {
      throw new StateError('not_found', `没有这条作品：${id}`);
    }
    return found;
  };
  const byWork = (platform: VideoPlatform, workId: string): VideoWorkRow | undefined => {
    const row = db.get('SELECT * FROM video_works WHERE platform = $platform AND work_id = $work',
      { platform, work: workId });
    return row === undefined ? undefined : decodeWork(row);
  };
  const where = (filter: VideoPageFilter): { sql: string; params: Record<string, string> } => {
    const clauses = ['platform = $platform'];
    const params: Record<string, string> = { platform: filter.platform };
    if (filter.folder !== undefined) {
      clauses.push('EXISTS (SELECT 1 FROM json_each(folder_ids) WHERE value = $folder)');
      params['folder'] = filter.folder;
    }
    const q = filter.q?.trim() ?? '';
    if (q !== '') {
      clauses.push("(title LIKE $q ESCAPE '\\' OR author LIKE $q ESCAPE '\\' OR caption LIKE $q ESCAPE '\\')");
      params['q'] = `%${escapeLike(q)}%`;
    }
    if (filter.phase !== undefined) {
      clauses.push(filter.phase === 'done' ? "stage = 'summarized'" : "stage <> 'summarized'");
    }
    return { sql: clauses.join(' AND '), params };
  };
  return {
    get,
    require,
    byWork,
    withoutSpace(limit: number): VideoWorkRow[] {
      return db.all(`SELECT * FROM video_works WHERE stage = 'summarized' AND digest IS NOT NULL
        AND space_id IS NULL ORDER BY created_at LIMIT $limit`, { limit }).map(decodeWork);
    },
    withSpace(limit: number): VideoWorkRow[] {
      return db.all(`SELECT * FROM video_works WHERE digest IS NOT NULL AND space_id IS NOT NULL
        ORDER BY created_at DESC LIMIT $limit`, { limit }).map(decodeWork);
    },
    needsOrderBackfill(): boolean {
      return db.get(`SELECT id FROM video_works
        WHERE platform = 'douyin' AND collect_seq IS NULL AND NOT EXISTS (
          SELECT 1 FROM video_mac_jobs WHERE kind = 'list' AND state = 'done'
            AND CASE WHEN json_valid(work_id) THEN json_extract(work_id, '$.full') END = 1
        ) LIMIT 1`) !== undefined;
    },
    needsCoverBackfill(): boolean {
      return db.get(`SELECT id FROM video_works
        WHERE platform = 'douyin' AND cover_url IS NULL AND NOT EXISTS (
          SELECT 1 FROM video_mac_jobs WHERE kind = 'list' AND state = 'done'
            AND CASE WHEN json_valid(work_id) THEN json_extract(work_id, '$.full') END = 1
            AND finished_at >= (SELECT applied_at FROM schema_migrations WHERE id = '0131-video-cover')
        ) LIMIT 1`) !== undefined;
    },
    upsert(input: NewVideoWork): { work: VideoWorkRow; created: boolean } {
      return db.transaction(() => {
        const existing = byWork(input.platform, input.workId);
        const at = context.now();
        if (existing !== undefined) {
          const folders = [...new Set([...existing.folderIds, ...(input.folderIds ?? [])])];
          db.run(`UPDATE video_works SET title = $title,
            caption = CASE WHEN $caption = '' THEN caption ELSE $caption END,
            author = COALESCE($author, author), kind = COALESCE(kind, $kind),
            collected_at = CASE WHEN $base >= COALESCE(collect_seq, 0) THEN $collected
              WHEN $seq IS NULL THEN COALESCE(collected_at, $collected) ELSE collected_at END,
            collect_seq = CASE WHEN $base >= COALESCE(collect_seq, 0) THEN $seq ELSE collect_seq END,
            duration_seconds = COALESCE(duration_seconds, $duration),
            cover_url = COALESCE($cover, cover_url),
            folder_ids = $folders, updated_at = $at WHERE id = $id`, {
            id: existing.id, title: input.title || existing.title, caption: input.caption ?? '',
            author: input.author ?? null, kind: input.kind ?? null,
            collected: input.collectedAt ?? null, seq: input.collectSeq ?? null,
            base: input.collectSeqBase ?? input.collectSeq ?? null, duration: input.durationSeconds ?? null,
            cover: input.coverUrl ?? null, folders: JSON.stringify(folders), at,
          });
          return { work: require(existing.id), created: false };
        }
        const id = `video_${randomUUID()}`;
        db.run(`INSERT INTO video_works (id, created_at, updated_at, version, platform, work_id, url, kind, title,
          caption, author, collected_at, collect_seq, duration_seconds, cover_url, folder_ids, stage, want, run)
          VALUES ($id, $at, $at, 1, $platform, $work, $url, $kind, $title, $caption, $author, $collected, $seq,
          $duration, $cover, $folders, 'synced', 'none', 'idle')`, {
          id, at, platform: input.platform, work: input.workId, url: input.url, kind: input.kind ?? null,
          title: input.title, caption: input.caption ?? '', author: input.author ?? null,
          collected: input.collectedAt ?? null, seq: input.collectSeq ?? null, duration: input.durationSeconds ?? null,
          cover: input.coverUrl ?? null, folders: JSON.stringify(input.folderIds ?? []),
        });
        return { work: require(id), created: true };
      });
    },
    page(filter: VideoPageFilter, limit: number, offset: number): { works: VideoWorkRow[]; total: number } {
      const { sql, params } = where(filter);
      const total = Number(db.get(`SELECT count(*) AS n FROM video_works WHERE ${sql}`, params)?.['n'] ?? 0);
      const rows = db.all(`SELECT * FROM video_works WHERE ${sql}
        ORDER BY collect_seq DESC, created_at DESC, id DESC LIMIT $limit OFFSET $offset`,
      { ...params, limit, offset });
      return { works: rows.map(decodeWork), total };
    },
    counts(filter: Omit<VideoPageFilter, 'phase'>): { all: number; todo: number; done: number } {
      const { sql, params } = where(filter);
      const row = db.get(`SELECT count(*) AS n, COALESCE(sum(stage = 'summarized'), 0) AS done
        FROM video_works WHERE ${sql}`, params);
      const all = Number(row?.['n'] ?? 0);
      const done = Number(row?.['done'] ?? 0);
      return { all, todo: all - done, done };
    },
    idsInFolder(platform: VideoPlatform, folder: string): string[] {
      return db.all(`SELECT id FROM video_works WHERE platform = $platform
        AND EXISTS (SELECT 1 FROM json_each(folder_ids) WHERE value = $folder)`, { platform, folder })
        .map((row) => String(row['id']));
    },
    byFeedItem(feedItemId: string): VideoWorkRow | undefined {
      const row = db.get('SELECT * FROM video_works WHERE feed_item_id = $id', { id: feedItemId });
      return row === undefined ? undefined : decodeWork(row);
    },
    newestWorkIds(platform: VideoPlatform, limit: number): string[] {
      return db.all(`SELECT work_id FROM video_works WHERE platform = $platform
        ORDER BY collect_seq DESC, created_at DESC LIMIT $limit`, { platform, limit })
        .map((row) => String(row['work_id']));
    },
    want(ids: readonly string[]): string[] {
      return db.transaction(() => {
        const queued: string[] = [];
        for (const id of ids) {
          const changes = db.run(`UPDATE video_works SET want = 'full', run = 'queued', error = NULL,
            resolved = CASE WHEN run = 'failed' AND platform = 'douyin' AND stage <> 'transcribed' THEN NULL
              ELSE resolved END,
            version = version + 1, updated_at = $at
            WHERE id = $id AND stage <> 'summarized' AND run IN ('idle', 'failed')`, { id, at: context.now() });
          if (changes > 0) {
            queued.push(id);
          }
        }
        return queued;
      });
    },
    withRun(run: VideoRun, limit: number): VideoWorkRow[] {
      return db.all('SELECT * FROM video_works WHERE run = $run ORDER BY updated_at, id LIMIT $limit', { run, limit })
        .map(decodeWork);
    },
    countRun(run: VideoRun): number {
      return Number(db.get('SELECT count(*) AS n FROM video_works WHERE run = $run', { run })?.['n'] ?? 0);
    },
    advance(id: string, patch: VideoAdvance): VideoWorkRow {
      return db.transaction(() => {
        const current = require(id);
        if (patch.stage !== undefined && stageIndex(patch.stage) < stageIndex(current.stage)) {
          throw new StateError('invalid_input', `作品 ${id} 已经${current.stage}，不能退回 ${patch.stage}。`);
        }
        const sets: string[] = ['version = version + 1', 'updated_at = $at'];
        const params: Record<string, string | number | null> = { id, at: context.now() };
        const put = (column: string, value: string | number | null): void => {
          sets.push(`${column} = $${column}`);
          params[column] = value;
        };
        if (patch.stage !== undefined) { put('stage', patch.stage); }
        if (patch.run !== undefined) { put('run', patch.run); }
        if (patch.error !== undefined) { put('error', patch.error); }
        if (patch.kind !== undefined) { put('kind', patch.kind); }
        if (patch.caption !== undefined) { put('caption', patch.caption); }
        if (patch.durationSeconds !== undefined) { put('duration_seconds', patch.durationSeconds); }
        if (patch.preview !== undefined) { put('preview', JSON.stringify(patch.preview)); }
        if (patch.transcript !== undefined) { put('transcript', patch.transcript); }
        if (patch.transcriptSource !== undefined) { put('transcript_source', patch.transcriptSource); }
        if (patch.digest !== undefined) { put('digest', JSON.stringify(patch.digest)); }
        if (patch.resolved !== undefined) {
          put('resolved', patch.resolved === null ? null : JSON.stringify(patch.resolved));
        }
        if (patch.timing !== undefined) { put('timing', JSON.stringify(patch.timing)); }
        if (patch.spaceId !== undefined) { put('space_id', patch.spaceId); }
        if (patch.feedItemId !== undefined) { put('feed_item_id', patch.feedItemId); }
        if (patch.run === 'failed') { sets.push('attempts = attempts + 1'); }
        db.run(`UPDATE video_works SET ${sets.join(', ')} WHERE id = $id`, params);
        return require(id);
      });
    },
    requeueWaitingTranscriber(): number {
      return db.run(`UPDATE video_works SET run = 'queued', error = NULL, version = version + 1, updated_at = $at
        WHERE want = 'full' AND run = 'idle' AND stage IN ('synced', 'previewed')`, { at: context.now() });
    },
    requeueRunning(): number {
      return db.run(`UPDATE video_works SET run = 'queued', version = version + 1, updated_at = $at
        WHERE run = 'running'`, { at: context.now() });
    },
  };
}

function createVideoFolderStore(context: StoreContext) {
  return {
    upsert(platform: VideoPlatform, folders: readonly DouyinFolderView[]): void {
      const at = context.now();
      context.db.transaction(() => {
        for (const folder of folders) {
          context.db.run(`INSERT INTO video_folders (platform, folder_id, name, count, synced_at)
            VALUES ($platform, $id, $name, $count, $at)
            ON CONFLICT (platform, folder_id) DO UPDATE SET name = $name, count = $count, synced_at = $at`,
          { platform, id: folder.id, name: folder.name, count: folder.count, at });
        }
      });
    },
    list(platform: VideoPlatform): DouyinFolderView[] {
      return context.db.all('SELECT * FROM video_folders WHERE platform = $platform ORDER BY name', { platform })
        .map((row) => ({ id: String(row['folder_id']), name: String(row['name']),
          count: typeof row['count'] === 'number' ? row['count'] : null }));
    },
  };
}

export function createVideoStores(context: StoreContext) {
  return {
    videoWorks: createVideoWorkStore(context),
    videoFolders: createVideoFolderStore(context),
    videoMacJobs: createMacJobStore(context),
  };
}

export type VideoWorkStore = ReturnType<typeof createVideoWorkStore>;

export function waitingTranscriber(work: Pick<VideoWorkRow, 'want' | 'run' | 'stage'>): boolean {
  return work.want === 'full' && work.run === 'idle' && (work.stage === 'synced' || work.stage === 'previewed');
}
