// 抖音收藏（《优化清单》第 9 条，11-07 改）：不全量处理。他点「同步」排一件「翻收藏」给 Mac，Mac 用他登录着的状态
// 只拿标题、作者、收藏时间、链接（新收藏在前，翻到上次同步过的就停）；他勾选或指定收藏夹才处理；处理过的不重复。
// 下载地址也由 Mac 取（取地址要 Mac 在线，不在线就排着）。登录状态只在 Mac 上，不进服务器。

import {
  NODE_ONLINE_MS,
  shortVideoTitle,
  type DouyinFolderView,
  type DouyinJob,
  type DouyinListResponse,
  type DouyinPhaseFilter,
  type DouyinReport,
  type DouyinSyncView,
  type VideoWorkView,
} from '../../shared/api/index.ts';
import { waitingTranscriber, type StateService, type VideoWorkRow } from '../state/index.ts';
import type { VideoWorker } from './worker.ts';

/** Mac 取走一件活多久没交回就再给一次（Mac 中途掉线、页面没载出来）。 */
export const MAC_JOB_STALE_MS = 10 * 60 * 1000;
/** 一次给 Mac 的活最多这么多件。 */
const JOBS_PER_POLL_MAX = 20;
/** 告诉 Mac 「翻到这些就停」的最新几条。 */
const SINCE_IDS_MAX = 50;

export const DOUYIN_ERROR_TEXT: Readonly<Record<NonNullable<DouyinReport['error']>['code'], string>> = {
  signed_out: '电脑上的抖音没登录：在 Plasticine 浏览器里登录抖音后再同步。',
  layout_changed: '抖音改版了，电脑上读不到收藏，等更新。',
  load_failed: '电脑上抖音没载出来，稍后再同步。',
  not_found: '这条作品没了（删了或设了私密）。',
};

/** 装了桌面客户端、能领抖音活的电脑。 */
const COMPUTER_PLATFORMS: ReadonlySet<string> = new Set(['macos', 'windows', 'linux']);

export type DouyinState = Pick<StateService, 'videoWorks' | 'videoFolders' | 'videoMacJobs' | 'nodes'>;

export function workUrl(workId: string, kind: 'video' | 'images' | null): string {
  return `https://www.douyin.com/${kind === 'images' ? 'note' : 'video'}/${workId}`;
}

export function videoWorkView(work: VideoWorkRow): VideoWorkView {
  return { id: work.id, platform: work.platform, workId: work.workId, url: work.url, kind: work.kind,
    title: shortVideoTitle(work.title) || work.title, author: work.author,
    collectedAt: work.collectSeq === null ? null : work.collectedAt,
    durationSeconds: work.durationSeconds, coverUrl: work.coverUrl,
    folderIds: work.folderIds, stage: work.stage, want: work.want,
    run: waitingTranscriber(work) ? 'waiting_transcriber' : work.run, error: work.error,
    feedItemId: work.feedItemId, spaceId: work.spaceId, version: work.version };
}

export class DouyinFavorites {
  readonly #state: DouyinState;
  readonly #worker: Pick<VideoWorker, 'kick' | 'macFailed' | 'resolved'>;
  readonly #now: () => Date;
  readonly #changed: () => void;

  constructor(options: { state: DouyinState; worker: Pick<VideoWorker, 'kick' | 'macFailed' | 'resolved'>;
    now: () => Date; changed?: () => void }) {
    this.#state = options.state;
    this.#worker = options.worker;
    this.#now = options.now;
    this.#changed = options.changed ?? (() => undefined);
  }

  /**
   * 他的电脑在不在线（最近一分半来过）。Mac 和 Windows 的桌面客户端是同一套壳，都会来领抖音的活
   * （desktop/src/feeds/feed-runner.ts），所以哪台电脑在线都算；字段名 macOnline 是早先只有 Mac 时起的，线上格式不改。
   */
  macOnline(): boolean {
    const since = this.#now().getTime() - NODE_ONLINE_MS;
    return this.#state.nodes.list({ limit: 50 }).some((node) => COMPUTER_PLATFORMS.has(node.platform)
      && node.revokedAt === null && Date.parse(node.lastSeenAt) >= since);
  }

  syncView(): DouyinSyncView {
    const { open, lastDoneAt, lastFailed } = this.#state.videoMacJobs.lastList();
    if (open !== null) {
      return { lastAt: lastDoneAt, state: open.state === 'taken' ? 'running' : 'waiting_mac', error: null };
    }
    if (lastFailed !== null) {
      return { lastAt: lastDoneAt, state: 'failed', error: lastFailed.error };
    }
    return { lastAt: lastDoneAt, state: 'idle', error: null };
  }

  /** 排一次同步（同一件没了结就不另排）。 */
  sync(full = false): DouyinSyncView {
    this.#state.videoMacJobs.queue('list', null, full || this.#state.videoWorks.needsOrderBackfill()
      || this.#state.videoWorks.needsCoverBackfill());
    return this.syncView();
  }

  list(filter: { folder?: string; q?: string; phase?: DouyinPhaseFilter }, limit: number, offset: number):
    DouyinListResponse {
    const page = this.#state.videoWorks.page({ platform: 'douyin', ...filter }, limit, offset);
    const folders: DouyinFolderView[] = this.#state.videoFolders.list('douyin');
    const counted = { ...(filter.folder === undefined ? {} : { folder: filter.folder }),
      ...(filter.q === undefined ? {} : { q: filter.q }) };
    return {
      works: page.works.map(videoWorkView),
      total: page.total,
      counts: this.#state.videoWorks.counts({ platform: 'douyin', ...counted }),
      nextOffset: offset + page.works.length < page.total ? offset + page.works.length : null,
      folders,
      sync: this.syncView(),
      macOnline: this.macOnline(),
    };
  }

  /** 处理他勾选的（或整个收藏夹）：处理过的、在排的不重复。回排上的那几条。 */
  process(input: { ids?: readonly string[]; folder?: string }): { works: VideoWorkRow[]; queued: number } {
    const ids = [...new Set([...(input.ids ?? []),
      ...(input.folder === undefined ? [] : this.#state.videoWorks.idsInFolder('douyin', input.folder))])];
    const known = ids.filter((id) => this.#state.videoWorks.get(id)?.platform === 'douyin');
    const queued = this.#state.videoWorks.want(known);
    this.#worker.kick();
    this.#changed();
    return { works: known.map((id) => this.#state.videoWorks.require(id)), queued: queued.length };
  }

  /** Mac 来取活。 */
  jobs(): DouyinJob[] {
    const stale = new Date(this.#now().getTime() - MAC_JOB_STALE_MS).toISOString();
    const taken = this.#state.videoMacJobs.take(stale, JOBS_PER_POLL_MAX);
    if (taken.length > 0) {
      this.#changed();
    }
    return taken.flatMap((job): DouyinJob[] => {
      if (job.kind === 'list') {
        return [{ id: job.id, kind: 'list', full: job.full,
          sinceIds: job.full ? [] : this.#state.videoWorks.newestWorkIds('douyin', SINCE_IDS_MAX) }];
      }
      const work = job.workId === null ? undefined : this.#state.videoWorks.byWork('douyin', job.workId);
      if (work === undefined) {
        this.#state.videoMacJobs.finish(job.id, '这条作品不在库里了。');
        return [];
      }
      return [{ id: job.id, kind: 'resolve', workId: work.workId, url: work.url }];
    });
  }

  /**
   * Mac 交回一件活。同一份再交一次（回执丢了重发）不会出两条：作品按 ID 去重、了结过的活不再动。翻收藏可以分几次交，
   * done 才算这次同步完了。
   */
  report(report: DouyinReport): { accepted: boolean; added: number } {
    const job = this.#state.videoMacJobs.get(report.jobId);
    if (job === undefined || job.state === 'done' || job.state === 'failed') {
      return { accepted: false, added: 0 };
    }
    let added = 0;
    if (report.list !== undefined && job.kind === 'list') {
      this.#state.videoFolders.upsert('douyin', report.list.folders);
      for (const listed of report.list.works) {
        const { created } = this.#state.videoWorks.upsert({ platform: 'douyin', workId: listed.workId,
          url: workUrl(listed.workId, listed.kind), title: shortVideoTitle(listed.title || listed.caption) || '（无标题）',
          caption: listed.caption, author: listed.author, kind: listed.kind,
          collectedAt: listed.listPosition === undefined ? null : listed.collectedAt,
          ...(listed.listPosition === undefined || job.sequenceBase === null ? {}
            : { collectSeq: job.sequenceBase - listed.listPosition, collectSeqBase: job.sequenceBase }),
          durationSeconds: listed.durationSeconds, coverUrl: listed.coverUrl ?? null, folderIds: listed.folderIds });
        added += created ? 1 : 0;
      }
    }
    const open = job.state === 'waiting' || job.state === 'taken';
    if (report.error !== undefined) {
      const reason = DOUYIN_ERROR_TEXT[report.error.code];
      if (open) {
        this.#state.videoMacJobs.finish(job.id, reason);
      }
      if (job.kind === 'resolve' && job.workId !== null) {
        this.#worker.macFailed(job.workId, reason);
      }
    } else if (report.resolved !== undefined && job.kind === 'resolve') {
      this.#worker.resolved(report.resolved.workId, report.resolved);
      if (open) {
        this.#state.videoMacJobs.finish(job.id, null);
      }
    } else if (report.list?.done === true && job.kind === 'list' && open) {
      this.#state.videoMacJobs.finish(job.id, null);
    }
    this.#changed();
    return { accepted: open, added };
  }
}
