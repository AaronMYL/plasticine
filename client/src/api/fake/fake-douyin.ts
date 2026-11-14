// 假接口的抖音收藏（第 6 批第 9 条，设计稿 Feed-Douyin）：一千多条收藏，前面几条是设计稿上的，走到哪各不相同；
// 同步立刻「翻完」，处理选中的把没总结过的排上。只给开发和截图用。

import type {
  DouyinListQuery,
  DouyinListResponse,
  DouyinProcessRequest,
  DouyinProcessResponse,
  DouyinSyncRequest,
  DouyinSyncResponse,
  DouyinSyncView,
  TranscriberInstallRequest,
  TranscriberResponse,
  TranscriberStatus,
  VideoWorkView,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import { picture } from './feed-seed.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeDouyinDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
  publishWork?: (work: VideoWorkView) => string;
  /** 假装装本地转写要多久（每一步）；0 立刻装好（测试）。 */
  installStepMs?: number;
}

/** 和真组件在 Linux 上下载的大小差不多（「约 220 MB」）。 */
const KIT_BYTES = 217_524_000;
const INSTALL_STEPS = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_DEFAULT = 50;
/** 收藏总数，和第13批设计稿一样（「全部 1434」）。 */
const SEED_TOTAL = 1_434;
/** 除了第一条，这两条也整理过：排得靠后，只读前一页时看不到（第13批：「已整理」要在服务端筛）。 */
const SUMMARIZED_DEEP = new Set([435, 643]);
const STAGES = ['synced', 'previewed', 'transcribed', 'summarized'] as const;

const DESIGN: ReadonlyArray<readonly [string, string, number, number, boolean]> = [
  ['普通人做指数定投的三个误区', '理财小课堂', 1, 4, true],
  ['30 天把英语听力练到能看美剧', '英语阿卡', 3, 2, true],
  ['一口气看懂睡眠周期', '科普君', 5, 1, false],
  ['独立开发者怎么定价', '小产品笔记', 8, 1, true],
  ['家常红烧肉', '厨房日记', 10, 1, false],
  ['城市骑行路线推荐', '周末去哪', 17, 1, false],
];
const FILLER = ['三分钟学会手冲咖啡', '租房避坑指南', '一周健身计划', '读书笔记怎么记', '周末短途旅行清单',
  '如何提高专注力', '新手学吉他第一课', '家庭收纳技巧'];

export const DOUYIN_FOLDERS = [
  { id: 'f_money', name: '理财', count: 86 },
  { id: 'f_learn', name: '学习', count: 214 },
  { id: 'f_food', name: '做饭', count: 57 },
];

const COVERS: readonly (readonly [string, string, string])[] = [
  ['#e7e3da', '#cfc8b8', '#cc7d5e'], ['#dfe4dc', '#b9c4b4', '#587559'], ['#e4e2ea', '#c9c5d4', '#5a6b85'],
];

export class FakeDouyin {
  private readonly deps: FakeDouyinDeps;
  private readonly works: VideoWorkView[] = [];
  private sync: DouyinSyncView;
  private transcriber: TranscriberStatus = { state: 'absent', source: null, totalBytes: KIT_BYTES, doneBytes: 0,
    step: null, error: null };

  constructor(deps: FakeDouyinDeps) {
    this.deps = deps;
    this.sync = { lastAt: new Date(deps.now().getTime() - DAY_MS).toISOString(), state: 'idle', error: null };
    this.seed();
  }

  private seed(): void {
    const now = this.deps.now().getTime();
    DESIGN.forEach(([title, author, daysAgo, stage, money], index) => {
      this.works.push(this.work(index, title, author, now - daysAgo * DAY_MS, stage, money ? ['f_money'] : []));
    });
    // 「城市骑行路线推荐」是点过「处理」、在等本地转写装好的视频（第13批设计稿）。
    Object.assign(this.works[5]!, { want: 'full', run: 'waiting_transcriber' });
    for (let index = DESIGN.length; index < SEED_TOTAL; index += 1) {
      const title = FILLER[index % FILLER.length] ?? '收藏';
      this.works.push(this.work(index, title, '收藏的作者', now - (18 + index) * DAY_MS,
        SUMMARIZED_DEEP.has(index) ? 4 : 1, []));
    }
  }

  private work(index: number, title: string, author: string, at: number, stage: number, folderIds: string[]):
    VideoWorkView {
    const workId = String(7_300_000_000_000_000_000n + BigInt(index));
    return { id: `video_fake_${index}`, platform: 'douyin', workId, url: `https://www.douyin.com/video/${workId}`,
      kind: 'video', title, author, collectedAt: index === 0 ? null : new Date(at).toISOString(),
      durationSeconds: 60 + index % 300,
      // 前几条有封面（竖版），后面的没有，看得到两种样子。
      coverUrl: index < 6 ? picture(4 / 3, COVERS[index % COVERS.length]!) : null,
      folderIds, stage: STAGES[stage - 1] ?? 'synced', want: stage > 1 ? 'full' : 'none', run: 'idle', error: null,
      feedItemId: null, version: 1 };
  }

  async list(query: DouyinListQuery): Promise<DouyinListResponse> {
    this.deps.session.require();
    const q = query.q?.trim().toLowerCase() ?? '';
    const searched = this.works
      .filter((work) => query.folder === undefined || work.folderIds.includes(query.folder))
      .filter((work) => q === '' || `${work.title} ${work.author ?? ''}`.toLowerCase().includes(q));
    const done = searched.filter((work) => work.stage === 'summarized').length;
    const matched = query.phase === undefined ? searched
      : searched.filter((work) => (work.stage === 'summarized') === (query.phase === 'done'));
    const limit = query.limit ?? PAGE_DEFAULT;
    const offset = query.offset ?? 0;
    const works = matched.slice(offset, offset + limit);
    for (const work of works) {
      if (work.stage === 'summarized') work.spaceId = this.deps.publishWork?.(work) ?? null;
    }
    return { works: structuredClone(works), total: matched.length,
      counts: { all: searched.length, todo: searched.length - done, done },
      nextOffset: offset + works.length < matched.length ? offset + works.length : null,
      folders: DOUYIN_FOLDERS, sync: this.sync, macOnline: true };
  }

  async syncNow(input: DouyinSyncRequest): Promise<DouyinSyncResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/video/douyin/sync', () => {
      this.sync = { lastAt: this.deps.now().toISOString(), state: 'idle', error: null };
      this.deps.bus.emit({ type: 'video.changed' });
      return { sync: this.sync };
    });
  }

  async process(input: DouyinProcessRequest): Promise<DouyinProcessResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/video/douyin/process', () => {
      const ids = new Set(input.ids ?? []);
      let queued = 0;
      for (const work of this.works) {
        const chosen = ids.has(work.id) || (input.folder !== undefined && work.folderIds.includes(input.folder));
        if (chosen && work.stage !== 'summarized' && work.run !== 'queued') {
          // 没装本地转写：视频停在「等转写装好」，不下载。
          const run = work.kind === 'video' && this.transcriber.state !== 'ready' ? 'waiting_transcriber' : 'queued';
          Object.assign(work, { want: 'full', run, version: work.version + 1 });
          queued += 1;
        }
      }
      this.deps.bus.emit({ type: 'video.changed' });
      return { works: structuredClone(this.works.filter((work) => ids.has(work.id))), queued };
    });
  }

  async transcriberStatus(): Promise<TranscriberResponse> {
    this.deps.session.require();
    return { status: structuredClone(this.transcriber) };
  }

  /** 假装在后台下载、解开；装好以后在等转写的排上。 */
  async installTranscriber(input: TranscriberInstallRequest): Promise<TranscriberResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/video/transcriber/install', () => {
      if (this.transcriber.state === 'absent' || this.transcriber.state === 'failed') {
        this.setTranscriber({ state: 'installing', doneBytes: 0, step: 'download', error: null });
        this.installStep(1);
      }
      return { status: structuredClone(this.transcriber) };
    });
  }

  private installStep(step: number): void {
    const wait = this.deps.installStepMs ?? 0;
    const next = (): void => {
      if (step >= INSTALL_STEPS) {
        this.setTranscriber({ state: 'ready', source: 'kit', doneBytes: KIT_BYTES, step: null });
        for (const work of this.works) {
          if (work.run === 'waiting_transcriber') Object.assign(work, { run: 'queued', version: work.version + 1 });
        }
        this.deps.bus.emit({ type: 'video.changed' });
        return;
      }
      this.setTranscriber({ doneBytes: Math.round(KIT_BYTES * Math.min(1, step / (INSTALL_STEPS - 2))),
        step: step >= INSTALL_STEPS - 1 ? 'unpack' : 'download' });
      this.installStep(step + 1);
    };
    if (wait > 0) setTimeout(next, wait); else next();
  }

  private setTranscriber(patch: Partial<TranscriberStatus>): void {
    this.transcriber = { ...this.transcriber, ...patch };
    this.deps.bus.emit({ type: 'transcriber.changed', status: structuredClone(this.transcriber) });
  }
}
