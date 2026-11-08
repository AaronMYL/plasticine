// 视频解析的排队（《优化清单》第 9 条）：他勾选的、对话里交来的作品排着，一条条往前走。排进后台线的并发上限（3）里跑：
// 同时在跑的后台线加上在跑的视频不超过 3（slots 由装配给：3 减去正在跑的后台线）；转写最吃 CPU，一次只转一条。
// 抖音作品要 Mac 取下载地址时停在「等 Mac」，Mac 交回再排上。进程重启时还标着「在跑」的放回排队，从停下的那一步接着走。

import { DouyinResolvedSchema, type DouyinResolved } from '../../shared/api/video.ts';
import { Value } from 'typebox/value';
import type { StateService, VideoWorkRow } from '../state/index.ts';
import { failureText, safeLog } from '../shared-log.ts';
import { advanceWork, type PipelinePorts } from './pipeline.ts';

/** 视频自己最多同时走几条（再受 slots 限制）。 */
export const VIDEO_RUNS_MAX = 3;
/** 同时转写几条：2 核 4G 上转写一条就占满 CPU。 */
export const TRANSCRIBE_AT_ONCE = 1;

export type VideoWorkerState = Pick<StateService, 'videoWorks' | 'videoMacJobs'>;

export interface VideoWorkerOptions {
  state: VideoWorkerState;
  ports: Omit<PipelinePorts, 'works' | 'askMac' | 'transcribeLock'>;
  /** 还能开几条（后台线的并发上限减去在跑的后台线）。 */
  slots: () => number;
  /** 一条总结好了（提交之后）：抖音收藏的进信息流。 */
  summarized?: (work: VideoWorkRow) => void;
  /** 一条的状态变了（界面刷新）。 */
  changed?: (work: VideoWorkRow) => void;
}

type Waiter = (work: VideoWorkRow) => void;

/** 一把只放 n 个人进去的锁。 */
export function limiter(size: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (work) => {
    if (active >= size) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

export class VideoWorker {
  readonly #state: VideoWorkerState;
  readonly #ports: PipelinePorts;
  readonly #slots: () => number;
  readonly #summarized: (work: VideoWorkRow) => void;
  readonly #changed: (work: VideoWorkRow) => void;
  readonly #controller = new AbortController();
  readonly #running = new Map<string, Promise<void>>();
  readonly #waiters = new Map<string, Waiter[]>();

  constructor(options: VideoWorkerOptions) {
    this.#state = options.state;
    this.#slots = options.slots;
    this.#summarized = options.summarized ?? (() => undefined);
    this.#changed = options.changed ?? (() => undefined);
    this.#ports = {
      ...options.ports,
      works: options.state.videoWorks,
      transcribeLock: limiter(TRANSCRIBE_AT_ONCE),
      askMac: (work) => {
        options.state.videoMacJobs.queue('resolve', work.workId);
      },
    };
  }

  get running(): number {
    return this.#running.size;
  }

  /** 启动时：还标着在跑的放回排队，再开工。 */
  start(): void {
    this.#state.videoWorks.requeueRunning();
    this.kick();
  }

  /** 有空位就从排着的里取几条开始走。 */
  kick(): void {
    if (this.#controller.signal.aborted) {
      return;
    }
    const room = Math.min(VIDEO_RUNS_MAX, this.#slots()) - this.#running.size;
    if (room <= 0) {
      return;
    }
    const queued = this.#state.videoWorks.withRun('queued', room + this.#running.size)
      .filter((work) => !this.#running.has(work.id)).slice(0, room);
    for (const work of queued) {
      const run = this.#run(work.id).finally(() => {
        this.#running.delete(work.id);
        this.kick();
      });
      this.#running.set(work.id, run);
    }
  }

  /** Mac 交来了下载地址：存下，等 Mac 的那一条排回去。 */
  resolved(workId: string, resolved: DouyinResolved): VideoWorkRow | null {
    if (!Value.Check(DouyinResolvedSchema, resolved)) {
      throw new Error('下载地址的格式不对。');
    }
    const work = this.#state.videoWorks.byWork('douyin', workId);
    if (work === undefined) {
      return null;
    }
    const next = this.#state.videoWorks.advance(work.id, { resolved,
      ...(work.run === 'waiting_mac' ? { run: 'queued' as const, error: null } : {}) });
    this.#notify(next);
    this.kick();
    return next;
  }

  /** Mac 没取到（没登录、作品没了）：这一条记成没做成。 */
  macFailed(workId: string, reason: string): void {
    const work = this.#state.videoWorks.byWork('douyin', workId);
    if (work === undefined || work.run !== 'waiting_mac') {
      return;
    }
    this.#notify(this.#state.videoWorks.advance(work.id, { run: 'failed', error: reason }));
  }

  /** 等这一条停下来（总结好、没做成或在等 Mac）。 */
  waitFor(id: string, signal: AbortSignal): Promise<VideoWorkRow> {
    const current = this.#state.videoWorks.require(id);
    if (current.run !== 'queued' && current.run !== 'running') {
      return Promise.resolve(current);
    }
    return new Promise((resolve, reject) => {
      const list = this.#waiters.get(id) ?? [];
      const waiter: Waiter = (work) => {
        signal.removeEventListener('abort', onAbort);
        resolve(work);
      };
      const onAbort = (): void => {
        this.#waiters.set(id, (this.#waiters.get(id) ?? []).filter((entry) => entry !== waiter));
        reject(signal.reason instanceof Error ? signal.reason : new Error('不等了'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      list.push(waiter);
      this.#waiters.set(id, list);
    });
  }

  async settled(): Promise<void> {
    while (this.#running.size > 0) {
      await Promise.all([...this.#running.values()]);
    }
  }

  async stop(): Promise<void> {
    this.#controller.abort(new Error('服务停止，没走完的下次启动接着走。'));
    await Promise.allSettled([...this.#running.values()]);
  }

  async #run(id: string): Promise<void> {
    const works = this.#state.videoWorks;
    this.#notify(works.advance(id, { run: 'running', error: null }));
    try {
      const end = await advanceWork(id, this.#ports, this.#controller.signal);
      if (end === 'waiting_mac') {
        this.#notify(works.advance(id, { run: 'waiting_mac' }));
        return;
      }
      const done = works.advance(id, { run: 'idle' });
      this.#notify(done);
      try {
        this.#summarized(done);
      } catch (cause) {
        safeLog('error', 'after_commit_failed', { error: cause, stepKey: 'video_summarized', objectId: id });
      }
    } catch (cause) {
      if (this.#controller.signal.aborted) {
        return;
      }
      safeLog('warn', 'video_parse_failed', { error: cause, objectId: id });
      this.#notify(works.advance(id, { run: 'failed', error: failureText(cause) }));
    }
  }

  #notify(work: VideoWorkRow): void {
    if (work.run !== 'queued' && work.run !== 'running') {
      const list = this.#waiters.get(work.id) ?? [];
      this.#waiters.delete(work.id);
      for (const waiter of list) {
        waiter(work);
      }
    }
    try {
      this.#changed(work);
    } catch (cause) {
      safeLog('error', 'after_commit_failed', { error: cause, stepKey: 'video_changed', objectId: work.id });
    }
  }
}
