// 视频解析与抖音收藏的三张表（0095，《优化清单》第 9 条）：作品、收藏夹、要 Mac 做的事。
// 只存和读，不判断该做什么（那在 video/）。作品按 (platform, work_id) 去重；stage 只往前走。

import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import {
  VIDEO_STAGES,
  VideoDigestSchema,
  VideoPreviewSchema,
  VideoTimingSchema,
  DouyinResolvedSchema,
  type DouyinFolderView,
  type DouyinListedWork,
  type DouyinResolved,
  type VideoDigest,
  type VideoPlatform,
  type VideoPreview,
  type VideoRun,
  type VideoStage,
  type VideoTiming,
} from '../../shared/api/video.ts';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

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
  folderIds?: string[];
}

/** 往前走一步时一起写的东西。 */
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
}

export interface MacJobRow {
  id: string;
  kind: 'list' | 'resolve';
  workId: string | null;
  state: 'waiting' | 'taken' | 'done' | 'failed';
  error: string | null;
  createdAt: string;
  takenAt: string | null;
  finishedAt: string | null;
  full: boolean;
  sequenceBase: number | null;
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

/** list 任务复用 work_id 存取数上下文，resolve 任务仍存作品 ID；无需增加任务表字段。 */
function listContext(row: Row): { full: boolean; sequenceBase: number | null } {
  if (row['kind'] !== 'list' || row['work_id'] === null) { return { full: false, sequenceBase: null }; }
  const value: unknown = JSON.parse(String(row['work_id']));
  if (typeof value !== 'object' || value === null || !('full' in value) || !('sequenceBase' in value)
    || typeof value.full !== 'boolean' || !Number.isSafeInteger(value.sequenceBase)) {
    throw new StateError('corrupt_record', '翻收藏任务的顺序上下文无效。');
  }
  return { full: value.full, sequenceBase: Number(value.sequenceBase) };
}

/** 一次取数预留一百万个列表位置，与 DouyinListedWorkSchema 的上限一致。 */
const COLLECTION_SEQUENCE_SPAN = 1_000_000;

function decodeJob(row: Row): MacJobRow {
  const state = (['waiting', 'taken', 'done', 'failed'] as const).find((value) => value === row['state']);
  if (state === undefined) {
    throw new StateError('corrupt_record', `video_mac_jobs.state 不认识：${String(row['state'])}`);
  }
  return {
    id: String(row['id']),
    kind: row['kind'] === 'list' ? 'list' : 'resolve',
    workId: row['kind'] === 'list' ? null : nullableText(row, 'work_id'),
    ...listContext(row),
    state,
    error: nullableText(row, 'error'),
    createdAt: String(row['created_at']),
    takenAt: nullableText(row, 'taken_at'),
    finishedAt: nullableText(row, 'finished_at'),
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
    needsOrderBackfill(): boolean {
      return db.get(`SELECT id FROM video_works
        WHERE platform = 'douyin' AND collect_seq IS NULL AND NOT EXISTS (
          SELECT 1 FROM video_mac_jobs WHERE kind = 'list' AND state = 'done'
            AND CASE WHEN json_valid(work_id) THEN json_extract(work_id, '$.full') END = 1
        ) LIMIT 1`) !== undefined;
    },
    /** 加一条；同一作品已经在了就补上新知道的标题、配文、收藏夹，不动它走到哪。返回 created。 */
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
            folder_ids = $folders, updated_at = $at WHERE id = $id`, {
            id: existing.id, title: input.title || existing.title, caption: input.caption ?? '',
            author: input.author ?? null, kind: input.kind ?? null,
            collected: input.collectedAt ?? null, seq: input.collectSeq ?? null,
            base: input.collectSeqBase ?? input.collectSeq ?? null, duration: input.durationSeconds ?? null,
            folders: JSON.stringify(folders), at,
          });
          return { work: require(existing.id), created: false };
        }
        const id = `video_${randomUUID()}`;
        db.run(`INSERT INTO video_works (id, created_at, updated_at, version, platform, work_id, url, kind, title,
          caption, author, collected_at, collect_seq, duration_seconds, folder_ids, stage, want, run)
          VALUES ($id, $at, $at, 1, $platform, $work, $url, $kind, $title, $caption, $author, $collected, $seq,
          $duration, $folders, 'synced', 'none', 'idle')`, {
          id, at, platform: input.platform, work: input.workId, url: input.url, kind: input.kind ?? null,
          title: input.title, caption: input.caption ?? '', author: input.author ?? null,
          collected: input.collectedAt ?? null, seq: input.collectSeq ?? null, duration: input.durationSeconds ?? null,
          folders: JSON.stringify(input.folderIds ?? []),
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
    /** 收藏夹里的全部 id（「处理整个收藏夹」）。 */
    idsInFolder(platform: VideoPlatform, folder: string): string[] {
      return db.all(`SELECT id FROM video_works WHERE platform = $platform
        AND EXISTS (SELECT 1 FROM json_each(folder_ids) WHERE value = $folder)`, { platform, folder })
        .map((row) => String(row['id']));
    },
    byFeedItem(feedItemId: string): VideoWorkRow | undefined {
      const row = db.get('SELECT * FROM video_works WHERE feed_item_id = $id', { id: feedItemId });
      return row === undefined ? undefined : decodeWork(row);
    },
    /** 已经同步过的最新几条（Mac 翻收藏翻到它们就停）。 */
    newestWorkIds(platform: VideoPlatform, limit: number): string[] {
      return db.all(`SELECT work_id FROM video_works WHERE platform = $platform
        ORDER BY collect_seq DESC, created_at DESC LIMIT $limit`, { platform, limit })
        .map((row) => String(row['work_id']));
    },
    /**
     * 他要处理这几条：没总结过、没在动的排上（failed 的重来）；总结过的、在排 / 在跑的不动。返回真正排上的 id。
     * 没做成的抖音作品重来时丢掉旧的下载地址：地址带签名、几小时就过期，让 Mac 重新取一次。
     */
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
    /** 往前走：stage 不许往回退（退了抛错，不静默）。 */
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
    /** 重启时把还标着在跑的放回排队（进程没了，活没做完）。 */
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

function createMacJobStore(context: StoreContext) {
  const { db } = context;
  const newListContext = (full: boolean): string => {
    const latestWork = Number(db.get('SELECT MAX(collect_seq) AS n FROM video_works')?.['n'] ?? 0);
    const latestJob = Number(db.get(`SELECT MAX(CASE WHEN json_valid(work_id)
      THEN json_extract(work_id, '$.sequenceBase') END) AS n FROM video_mac_jobs WHERE kind = 'list'`)?.['n'] ?? 0);
    return JSON.stringify({ full, sequenceBase: Math.max(latestWork, latestJob) + COLLECTION_SEQUENCE_SPAN });
  };
  const get = (id: string): MacJobRow | undefined => {
    const row = db.get('SELECT * FROM video_mac_jobs WHERE id = $id', { id });
    return row === undefined ? undefined : decodeJob(row);
  };
  return {
    get,
    /** 排一件；同样的活（同一种、同一条作品）还没了结就不另排，回那一件。 */
    queue(kind: 'list' | 'resolve', workId: string | null, full = false): MacJobRow {
      return db.transaction(() => {
        const open = db.all(`SELECT * FROM video_mac_jobs WHERE kind = $kind
          AND ($kind = 'list' OR work_id IS $work) AND state IN ('waiting', 'taken') ORDER BY created_at`,
        { kind, work: workId }).map(decodeJob).find((job) => kind !== 'list' || !full || job.full);
        if (open !== undefined) { return open; }
        const id = `macjob_${randomUUID()}`;
        const work = kind === 'list' ? newListContext(full) : workId;
        db.run(`INSERT INTO video_mac_jobs (id, kind, work_id, state, created_at)
          VALUES ($id, $kind, $work, 'waiting', $at)`, { id, kind, work, at: context.now() });
        return get(id)!;
      });
    },
    /** Mac 来取：排着的全给；取走超过 staleBefore 还没交回的再给一次（Mac 中途掉线）。 */
    take(staleBefore: string, limit: number): MacJobRow[] {
      return db.transaction(() => {
        const rows = db.all(`SELECT * FROM video_mac_jobs WHERE state = 'waiting'
          OR (state = 'taken' AND taken_at < $stale) ORDER BY created_at LIMIT $limit`,
        { stale: staleBefore, limit }).map(decodeJob);
        for (const job of rows) {
          if (job.kind === 'list' && job.sequenceBase === null) {
            db.run('UPDATE video_mac_jobs SET work_id = $context WHERE id = $id',
              { id: job.id, context: newListContext(true) });
          }
          db.run("UPDATE video_mac_jobs SET state = 'taken', taken_at = $at WHERE id = $id",
            { id: job.id, at: context.now() });
        }
        return rows.map((job) => get(job.id)!);
      });
    },
    finish(id: string, error: string | null): void {
      db.run(`UPDATE video_mac_jobs SET state = $state, error = $error, finished_at = $at
        WHERE id = $id AND state IN ('waiting', 'taken')`,
      { id, state: error === null ? 'done' : 'failed', error, at: context.now() });
    },
    /** 最近一次翻收藏（界面上「上次同步」和这一次在不在等 Mac）。 */
    lastList(): { open: MacJobRow | null; lastDoneAt: string | null; lastFailed: MacJobRow | null } {
      const open = db.get(`SELECT * FROM video_mac_jobs WHERE kind = 'list' AND state IN ('waiting', 'taken')
        ORDER BY created_at DESC LIMIT 1`);
      const done = db.get(`SELECT finished_at FROM video_mac_jobs WHERE kind = 'list' AND state = 'done'
        ORDER BY finished_at DESC LIMIT 1`);
      const latest = db.get(`SELECT * FROM video_mac_jobs WHERE kind = 'list' AND state IN ('done', 'failed')
        ORDER BY finished_at DESC LIMIT 1`);
      const latestJob = latest === undefined ? null : decodeJob(latest);
      return {
        open: open === undefined ? null : decodeJob(open),
        lastDoneAt: done === undefined ? null : nullableText(done, 'finished_at'),
        lastFailed: latestJob?.state === 'failed' ? latestJob : null,
      };
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
export type VideoFolderStore = ReturnType<typeof createVideoFolderStore>;
export type MacJobStore = ReturnType<typeof createMacJobStore>;
