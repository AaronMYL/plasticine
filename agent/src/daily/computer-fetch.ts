// 服务器取不到的网址交给在线的电脑取（第13批，11-14 Aaron：「优先服务器抓，抓不到再改由在线的电脑重试」）：服务器
// 自己取，连不上、被拒、被限流时，有电脑在线就排一件「替服务器取这个网址」的活；电脑每半分钟来领
// （GET /v2/nodes/feed/fetch，shared/api/feed-computer-fetch.ts），用它自己的网络取回正文交回，解析、入库在
// feed-subscriptions.ts。活只记在内存里：服务器重启就没了，下一轮到点再取、再排。电脑两分钟没来领就当不在线。

import { randomUUID } from 'node:crypto';
import { COMPUTER_FETCH_JOBS_MAX, type ComputerFetchJob, type ComputerFetchReport } from
  '../../shared/api/feed-computer-fetch.ts';
import { DailyError } from './errors.ts';

/** 电脑多久没来领就当不在线（它每半分钟来一次）。 */
export const COMPUTER_ONLINE_MS = 2 * 60_000;
/** 领走多久没交回就再给一次。 */
const LEASE_MS = 2 * 60_000;
/** 一件活最多留多久。 */
const KEPT_MS = 30 * 60_000;

/** 替哪个来源取；discover：给的是网站地址，取回来的是网页时要从里面找订阅地址。 */
export interface ComputerFetchPurpose {
  sourceId: string;
  discover: boolean;
}

interface Job {
  id: string;
  url: string;
  purpose: ComputerFetchPurpose;
  at: number;
  leasedAt: number | null;
}

export class ComputerFetches {
  readonly #now: () => Date;
  readonly #jobs = new Map<string, Job>();
  #seenAt = Number.NEGATIVE_INFINITY;

  constructor(now: () => Date) {
    this.#now = now;
  }

  /** 最近有电脑来领过活。 */
  online(): boolean {
    return this.#now().getTime() - this.#seenAt < COMPUTER_ONLINE_MS;
  }

  /** 排一件；同一个来源已经排着就不再排。电脑不在线不排、回 false。 */
  ask(url: string, purpose: ComputerFetchPurpose): boolean {
    this.#prune();
    if (!this.online()) { return false; }
    const queued = [...this.#jobs.values()].some((job) => job.purpose.sourceId === purpose.sourceId);
    if (!queued) {
      const id = `ff-${randomUUID()}`;
      this.#jobs.set(id, { id, url, purpose, at: this.#now().getTime(), leasedAt: null });
    }
    return true;
  }

  /** 电脑来领：记下它在线，给还没领走（或领走太久没交回）的几件。 */
  lease(): ComputerFetchJob[] {
    const now = this.#now().getTime();
    this.#seenAt = now;
    this.#prune();
    const jobs = [...this.#jobs.values()]
      .filter((job) => job.leasedAt === null || now - job.leasedAt > LEASE_MS)
      .slice(0, COMPUTER_FETCH_JOBS_MAX);
    for (const job of jobs) { job.leasedAt = now; }
    return jobs.map((job) => ({ id: job.id, url: job.url }));
  }

  /** 交回一件：拿走它（同一件交两次只算一次）。 */
  take(jobId: string): { url: string; purpose: ComputerFetchPurpose } | undefined {
    const job = this.#jobs.get(jobId);
    this.#jobs.delete(jobId);
    return job === undefined ? undefined : { url: job.url, purpose: job.purpose };
  }

  #prune(): void {
    const now = this.#now().getTime();
    for (const [id, job] of this.#jobs) {
      if (now - job.at > KEPT_MS) { this.#jobs.delete(id); }
    }
  }
}

/**
 * 服务器没取到时，交不交给电脑、来源那一行写什么：连不上、超时、被拒、被限流交给电脑；对方自己出错（5xx）、地址不对
 * 不交（电脑取也一样）。回 null 就是不交。
 */
export function handOffText(kind: string, error: unknown): string | null {
  if (!(error instanceof DailyError)) { return null; }
  if (error.code === 'rate_limited') {
    return kind === 'reddit' ? 'Reddit 限流，已让在线的电脑去取' : '对方限流了，已让在线的电脑去取';
  }
  if (error.code !== 'unreachable' || error.message.includes('出错了')) { return null; }
  if (error.message.includes('超时')) { return '服务器等不到这个网站回应（超时），已让在线的电脑去取'; }
  if (error.message.includes('拒绝')) { return '这个网站拒绝了服务器的访问，已让在线的电脑去取'; }
  return '服务器连不上这个网站（连接被断开），已让在线的电脑去取';
}

/** 电脑也没取到：来源那一行写两边都没取到和电脑那边的原因。 */
export function computerFailureText(error: ComputerFetchReport['error']): string {
  if (error === null) { return '服务器和电脑都没取到'; }
  const why = error.code === 'http_error' ? `对方回了 ${String(error.status ?? '错误')}`
    : error.code === 'too_large' ? '正文超过 2 MB'
      : error.code === 'refused' ? '电脑不替服务器取这种地址'
        : error.detail?.trim() || '页面没打开';
  return `服务器和电脑都没取到（${why}）`;
}
